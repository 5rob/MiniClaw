// src/claude.js
// Anthropic API client with tool use loop, compaction, and system prompt builder
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

function buildSystemPrompt() {
  const cfg = loadConfig();

  // Load SOUL.md and IDENTITY.md (OpenClaw-style personality files)
  const soul = readFileIfExists(path.resolve(cfg.personality.soulFile || 'SOUL.md'));
  const identity = readFileIfExists(path.resolve(cfg.personality.identityFile || 'IDENTITY.md'));
  const longTermMemory = memory.readLongTermMemory();
  const recentLogs = memory.loadRecentDailyLogs(cfg.memory.loadDaysBack);

  // Load SKILL.md files for context (like OpenClaw does)
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

  return `${soul || '(No SOUL.md found — create one to define your personality)'}

${identity ? `## Identity\n${identity}` : ''}

Current date/time: ${new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })}

## Your Long-Term Memory
${longTermMemory}

## Recent Daily Logs
${dailyLogSection}

## Available Custom Skills
${skillDescriptions || '(No custom skills installed yet)'}

## Guidelines
- When I say "remember this" or share important info, write it to long-term memory immediately using memory_write.
- Log significant events and task completions to the daily log using memory_append_daily.
- Before answering questions about my preferences or past events, search memory using memory_search.
- When I ask you to build a new skill/tool, use the skill_builder tool to manage the project.
- Always use Australian Eastern time (AEDT/AEST) for calendar operations.
- You can update SOUL.md and IDENTITY.md to evolve your personality — but always tell me when you do.`;
}

// Conversation history per-channel (in-memory, resets on restart)
// Using Map instead of object with _flushed property hack
const conversationHistory = new Map();
const conversationState = new Map(); // Track flush state per channel
const MAX_HISTORY = 40; // messages per channel (backup limit)

export async function chat(channelId, userMessage) {
  const cfg = loadConfig();

  // Get or create conversation history for this channel
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
    conversationState.set(channelId, { flushed: false });
  }

  const history = conversationHistory.get(channelId);
  const state = conversationState.get(channelId);

  // Add user message
  history.push({ role: 'user', content: userMessage });

  try {
    // --- Compaction check (OpenClaw-style) ---
    if (cfg.compaction?.enabled) {
      const status = needsCompaction(history);

      if (status.shouldFlush && !state.flushed) {
        // Pre-compaction memory flush: let the AI save important context
        console.log(`[Claude] Approaching context limit (${status.currentTokens} tokens), flushing memory...`);
        await memoryFlush(history);
        state.flushed = true; // prevent double-flush (like OpenClaw)
      }

      if (status.shouldCompact) {
        console.log(`[Claude] Context limit reached (${status.currentTokens} tokens), compacting...`);
        const compacted = await compactHistory(history);
        history.length = 0;
        history.push(...compacted);
        state.flushed = false; // reset flush tracker

        // Re-index memory after flush may have written new content
        try {
          const { indexMemoryFiles } = await import('./memory-index.js');
          indexMemoryFiles().catch(err => console.error('[Index]', err.message));
        } catch (err) {
          // Memory index not available, continue
        }
      }
    }

    // Trim history if too long (message count, separate from token-based compaction)
    while (history.length > MAX_HISTORY) {
      history.shift();
    }

    const tools = await getAllTools();
    const systemPrompt = buildSystemPrompt();

    let messages = [...history];
    let response;
    let iterations = 0;
    const MAX_ITERATIONS = 10; // Prevent infinite tool loops

    // Tool use loop — keep going until Claude stops calling tools
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      response = await client.messages.create({
        model: cfg.model.primary,
        max_tokens: cfg.model.maxTokens,
        system: systemPrompt,
        tools,
        messages
      });

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
  fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2));
  config = cfg; // Update cache
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
