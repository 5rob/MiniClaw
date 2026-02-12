// src/compaction.js
// Context compaction with pre-compaction memory flush (OpenClaw-style)
import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import * as memory from './memory.js';

const client = new Anthropic();
let config = null;

function loadConfig() {
  if (!config) {
    config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  }
  return config;
}

// Rough token estimation (~4 chars per token, like OpenClaw does)
export function estimateTokens(messages) {
  let total = 0;

  try {
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += Math.ceil(msg.content.length / 4);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            total += Math.ceil(block.text.length / 4);
          } else if (block.type === 'tool_result') {
            total += Math.ceil(JSON.stringify(block.content).length / 4);
          } else {
            total += Math.ceil(JSON.stringify(block).length / 4);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Compaction] Token estimation error:', err.message);
  }

  return total;
}

// Check if we're approaching the context limit
export function needsCompaction(messages) {
  const cfg = loadConfig();
  const { contextWindow = 200000 } = cfg.model;
  const { reserveTokensFloor = 20000 } = cfg.compaction;
  const softThreshold = cfg.compaction?.memoryFlush?.softThresholdTokens || 4000;

  const currentTokens = estimateTokens(messages);
  const threshold = contextWindow - reserveTokensFloor - softThreshold;

  return {
    shouldFlush: currentTokens >= threshold,
    shouldCompact: currentTokens >= (contextWindow - reserveTokensFloor),
    currentTokens,
    threshold
  };
}

// Run the silent memory flush turn (like OpenClaw's pre-compaction flush)
export async function memoryFlush(messages) {
  const cfg = loadConfig();
  const { memoryFlush: flushConfig } = cfg.compaction;

  if (!flushConfig?.enabled) return;

  console.log('[Compaction] Running pre-compaction memory flush...');

  try {
    // Send a silent agentic turn asking Claude to save important context
    const flushResponse = await client.messages.create({
      model: cfg.model.primary,
      max_tokens: 2000,
      system: flushConfig.systemPrompt,
      tools: [
        {
          name: 'memory_write',
          description: 'Write or update the curated long-term MEMORY.md file.',
          input_schema: {
            type: 'object',
            properties: { content: { type: 'string' } },
            required: ['content']
          }
        },
        {
          name: 'memory_append_daily',
          description: 'Append an entry to today\'s daily log.',
          input_schema: {
            type: 'object',
            properties: { entry: { type: 'string' } },
            required: ['entry']
          }
        }
      ],
      messages: [
        ...messages.slice(-20), // Last 20 messages for context
        { role: 'user', content: flushConfig.prompt }
      ]
    });

    // Execute any tool calls from the flush
    for (const block of flushResponse.content) {
      if (block.type === 'tool_use') {
        if (block.name === 'memory_write') {
          memory.writeLongTermMemory(block.input.content);
          console.log('[Compaction] Flushed to MEMORY.md');
        } else if (block.name === 'memory_append_daily') {
          memory.appendDailyLog(block.input.entry);
          console.log('[Compaction] Flushed to daily log');
        }
      }

      // Check for NO_REPLY (nothing to save)
      if (block.type === 'text' && block.text.includes('NO_REPLY')) {
        console.log('[Compaction] Nothing to flush (NO_REPLY)');
      }
    }
  } catch (err) {
    console.error('[Compaction] Memory flush failed:', err.message);
    // Gracefully continue — better to lose some memory than crash
  }
}

// Compact the message history by summarising older messages
export async function compactHistory(messages) {
  const cfg = loadConfig();

  console.log(`[Compaction] Compacting ${messages.length} messages...`);

  // Keep the most recent messages intact (last ~40% of the window)
  const keepRecent = Math.max(10, Math.floor(messages.length * 0.4));
  const oldMessages = messages.slice(0, messages.length - keepRecent);
  const recentMessages = messages.slice(-keepRecent);

  // Summarise the old messages
  try {
    const summaryResponse = await client.messages.create({
      model: cfg.model.fallback, // Use cheaper model for summarisation
      max_tokens: 2000,
      system: 'Summarise this conversation history concisely. Focus on: decisions made, tasks completed, important information shared, and any open items. Be factual and brief.',
      messages: [
        {
          role: 'user',
          content: oldMessages.map(m => {
            const role = m.role;
            let text = '';

            if (typeof m.content === 'string') {
              text = m.content;
            } else if (Array.isArray(m.content)) {
              text = JSON.stringify(m.content).slice(0, 500);
            }

            return `[${role}]: ${text}`;
          }).join('\n\n')
        }
      ]
    });

    const summary = summaryResponse.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    // Return compacted history: summary + recent messages
    const compacted = [
      {
        role: 'user',
        content: `[SYSTEM: Previous conversation summary from compaction]\n${summary}`
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our earlier conversation.'
      },
      ...recentMessages
    ];

    console.log(`[Compaction] Reduced ${messages.length} messages to ${compacted.length}`);
    return compacted;
  } catch (err) {
    console.error('[Compaction] Summary failed, falling back to truncation:', err.message);
    // Fallback: just keep recent messages
    return recentMessages;
  }
}
