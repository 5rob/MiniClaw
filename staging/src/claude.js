// src/claude.js
// Anthropic API client with tool use loop, compaction, and system prompt builder
// v1.13 — Lightweight system prompt for Haiku, no tools for Haiku mode, debounced re-indexing
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import * as memory from './memory.js';
import { getAllTools, executeTool } from './tools.js';
import { needsCompaction, memoryFlush, compactHistory } from './compaction.js';

const client = new Anthropic(); // Uses ANTHROPIC_API_KEY from env
let config = null;

function loadConfig() {
  if (!config) {
    config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  }
  return config;
}

function readFileIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
  } catch (err) {
    console.error(`[Claude] Error reading ${filePath}:`, err.message);
    return null;
  }
}

/**
 * Build the system prompt.
 * @param {boolean} lightweight - If true, skip memory/skills for Haiku chat mode
 */
function buildSystemPrompt(lightweight = false) {
  const cfg = loadConfig();

  const soul = readFileIfExists(path.resolve(cfg.personality.soulFile || 'SOUL.md'));
  const identity = readFileIfExists(path.resolve(cfg.personality.identityFile || 'IDENTITY.md'));

  // Always include personality
  let prompt = `${soul || '(No SOUL.md found — create one to define your personality)'}

${identity ? `## Identity\n${identity}` : ''}

Current date/time: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}`;

  // Staging notice (always included)
  const botRole = process.env.BOT_ROLE || 'live';
  if (botRole === 'staging') {
    prompt += `\n\n## ⚠️ Staging Instance Notice\nYou are **Tester Bud**, the staging/test instance. You exist for testing new features in the #staging channel. You share memory with the live bot but you are NOT the live bot. When greeted, identify yourself as Tester Bud. Do not claim to be the main/live instance. Your purpose is to test experimental changes safely before they go live.\n`;
  }

  if (lightweight) {
    // Haiku mode — minimal context, no memory dump, no skill descriptions
    prompt += `

## Note
You are in lightweight chat mode. You don't have access to tools right now. If Rob asks you to do something that needs tools (memory, calendar, files, building), let him know and he can switch to a more capable mode with !sonnet or !opus. Keep your responses natural and conversational.`;
  } else {
    // Full mode — include everything
    const longTermMemory = memory.readLongTermMemory();
    const recentLogs = memory.loadRecentDailyLogs(cfg.memory.loadDaysBack);

    const skillsDir = path.resolve('skills');
    let skillDescriptions = '';
    if (fs.existsSync(skillsDir)) {
      try {
        for (const name of fs.readdirSync(skillsDir)) {
          const skillMd = path.join(skillsDir, name, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            skillDescriptions += `\n### Skill: ${name}\n${fs.readFileSync(skillMd, 'utf-8')}\n`;
          }
        }
      } catch (err) {
        console.error('[Claude] Error loading skill descriptions:', err.message);
      }
    }

    const dailyLogSection = recentLogs.length > 0
      ? recentLogs.map(l => `### ${l.date}\n${l.content}`).join('\n')
      : '(No recent daily logs)';

    prompt += `

## Your Long-Term Memory
${longTermMemory}

## Recent Daily Logs
${dailyLogSection}

## Available Custom Skills
${skillDescriptions || '(No custom skills installed yet)'}

## Guidelines
- Budget your tool calls carefully.
- When editing files with file_manager, read the file once, make all changes in memory, then write the complete updated file in a single write call. Do not make multiple partial writes or re-read the same file repeatedly.
- When I say "remember this" or share important info, write it to long-term memory immediately using memory_write.
- Log significant events and task completions to the daily log using memory_append_daily.
- Before answering questions about my preferences or past events, search memory using memory_search.
- When I ask you to build a new skill/tool, use the code_builder tool to manage the project.
- Always use Australian Eastern time (AEDT/AEST) for calendar operations.`;
  }

  return prompt;
}

// Conversation history per channel
const conversationHistory = new Map();
const conversationState = new Map();

const MAX_HISTORY = 50; // Max message pairs to keep
const MAX_ITERATIONS = 10; // Max tool-use loops per turn

export async function chat(channelId, userMessage, conversationContext = null) {
  const cfg = loadConfig();

  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }

  const history = conversationHistory.get(channelId);

  // Inject conversation context if provided
  let messageContent = userMessage;
  if (conversationContext && conversationContext.length > 0) {
    let contextBlock = '--- Recent Conversation Context ---\n';
    for (const msg of conversationContext) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      contextBlock += `${label}: ${msg.content}\n`;
    }
    contextBlock += '--- End Context ---\n\n';
    messageContent = contextBlock + userMessage;
  }

  // Add user message (with context if applicable)
  history.push({ role: 'user', content: messageContent });

  try {
    // Check for compaction
    const compactionCheck = needsCompaction(history);

    if (compactionCheck.shouldFlush) {
      console.log(`[Claude] Context at ${compactionCheck.currentTokens} tokens — running memory flush`);
      await memoryFlush(history);
      // Mark index as dirty after compaction flush (re-indexes in background)
      try {
        const { markDirty } = await import('./memory-index.js');
        markDirty();
      } catch (err) {
        // Memory index not available, continue
      }
    }

    if (compactionCheck.shouldCompact) {
      console.log(`[Claude] Compacting history (${compactionCheck.currentTokens} tokens)`);
      const compacted = await compactHistory(history);
      history.length = 0;
      history.push(...compacted);
    }

    // Trim history if too long (message count)
    while (history.length > MAX_HISTORY) {
      history.shift();
    }

    // v1.13: Determine if we're in Haiku (lightweight) mode
    const isHaiku = cfg.model.primary.includes('haiku');
    const tools = isHaiku ? [] : await getAllTools();
    const systemPrompt = buildSystemPrompt(isHaiku);

    let messages = [...history];
    let response;
    let iterations = 0;

    // Tool use loop — keep going until Claude stops calling tools
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const apiParams = {
        model: cfg.model.primary,
        max_tokens: cfg.model.maxTokens,
        system: systemPrompt,
        messages
      };

      // Only include tools if we have them (not in Haiku mode)
      if (tools.length > 0) {
        apiParams.tools = tools;
      }

      response = await client.messages.create(apiParams);

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');

      if (toolUseBlocks.length === 0) break; // No more tool calls, we're done

      // Add assistant response with tool calls to messages
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and collect results
      const toolResults = [];

      for (const toolCall of toolUseBlocks) {
        try {
          console.log(`[Tool] Executing: ${toolCall.name}`, JSON.stringify(toolCall.input).slice(0, 200));
          const result = await executeTool(toolCall.name, toolCall.input);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify(result)
          });
        } catch (err) {
          console.error(`[Tool] Error in ${toolCall.name}:`, err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true
          });
        }
      }

      // Add tool results to messages
      messages.push({ role: 'user', content: toolResults });
    }

    if (iterations >= MAX_ITERATIONS) {
      console.warn('[Claude] Tool loop limit reached, stopping');
    }

    // Extract text response
    const textBlocks = response.content.filter(b => b.type === 'text');
    const finalText = textBlocks.map(b => b.text).join('\n');

    // Update conversation history with the final exchange
    history.push({ role: 'assistant', content: finalText });

    // Log this interaction to daily log (truncate if very long)
    const truncatedMessage = userMessage.slice(0, 100) + (userMessage.length > 100 ? '...' : '');
    memory.appendDailyLog(`User: ${truncatedMessage}`);

    return finalText;
  } catch (err) {
    console.error('[Claude] Error:', err);
    throw new Error(`Claude API error: ${err.message}`);
  }
}

// Allow changing model at runtime
export function setModel(modelId) {
  const cfg = loadConfig();
  cfg.model.primary = modelId;
  config = cfg; // Update in-memory cache (takes effect immediately)
  // Also persist to disk so it survives restarts
  try {
    fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.warn('[Claude] Could not persist model change to disk:', err.message);
  }
  return `Model changed to: ${modelId}`;
}

export function getModel() {
  const cfg = loadConfig();
  return cfg.model.primary;
}

// Clear conversation history for a channel (useful for testing)
export function clearHistory(channelId) {
  conversationHistory.delete(channelId);
  conversationState.delete(channelId);
  return 'Conversation history cleared for this channel.';
}