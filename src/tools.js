// src/tools.js
// Tool registry — loads built-in tools + custom skills
// v1.10: Added generate_image tool (Gemini image generation)
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as memory from './memory.js';
import * as calendar from './calendar.js';
import * as codeBuilder from './code-builder.js';
import { setModel, getModel } from './claude.js';
import { generateImage, cleanupTempFiles, isGeminiEnabled } from './gemini.js';

const SKILLS_DIR = path.resolve('skills');
let config = null;

function loadConfig() {
  if (!config) {
    config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
  }
  return config;
}

// Built-in tool definitions (Anthropic tool_use format)
const builtInTools = [
  {
    name: 'memory_read',
    description: 'Read long-term memory (MEMORY.md) and recent daily logs.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'How many days of daily logs to load (default 2)' }
      }
    }
  },
  {
    name: 'memory_write',
    description: 'Write or update the curated long-term MEMORY.md file. Use this for important facts, preferences, and decisions that should persist.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The full updated content for MEMORY.md' }
      },
      required: ['content']
    }
  },
  {
    name: 'memory_append_daily',
    description: 'Append an entry to today\'s daily log. Use for transient notes, conversation summaries, task completions.',
    input_schema: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'The log entry to append' }
      },
      required: ['entry']
    }
  },
  {
    name: 'memory_search',
    description: 'Search across all memory files (long-term + daily logs) using hybrid BM25 keyword + vector semantic search.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (natural language or keywords)' }
      },
      required: ['query']
    }
  },
  {
    name: 'calendar_list_events',
    description: 'List upcoming calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max events to return (default 10)' },
        daysAhead: { type: 'number', description: 'How many days ahead to look (default 7)' }
      }
    }
  },
  {
    name: 'calendar_create_event',
    description: 'Create a new calendar event. Times must be ISO 8601 format in Australia/Sydney timezone.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Event title' },
        startTime: { type: 'string', description: 'Start time (ISO 8601, e.g. 2026-02-15T14:00:00+11:00)' },
        endTime: { type: 'string', description: 'End time (ISO 8601)' },
        description: { type: 'string', description: 'Event description (optional)' },
        location: { type: 'string', description: 'Event location (optional)' }
      },
      required: ['summary', 'startTime', 'endTime']
    }
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete a calendar event by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'The event ID to delete' }
      },
      required: ['eventId']
    }
  },
  {
    name: 'calendar_update_event',
    description: 'Update an existing calendar event.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'The event ID to update' },
        summary: { type: 'string', description: 'New title (optional)' },
        startTime: { type: 'string', description: 'New start time (optional)' },
        endTime: { type: 'string', description: 'New end time (optional)' },
        description: { type: 'string', description: 'New description (optional)' },
        location: { type: 'string', description: 'New location (optional)' }
      },
      required: ['eventId']
    }
  },
  {
    name: "skill_execute",
    description: "Execute a custom skill handler",
    input_schema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "Name of the skill folder (e.g., 'file-reader')" },
        action: { type: "string", description: "Action to perform" },
        params: { type: "object", description: "Additional parameters" }
      },
      required: ["skillName"]
    }
  },
  {
    name: 'model_switcher',
    description: 'Switch between Claude models at runtime. Use "current" to check, "list" to see options, "switch" to change.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['current', 'switch', 'list'],
          description: 'Action: current (check model), switch (change model), list (show available)'
        },
        modelName: {
          type: 'string',
          enum: ['opus', 'sonnet', 'haiku'],
          description: 'Model shorthand to switch to (only for switch action)'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'generate_image',
    description: 'Generate an image using Gemini AI. Returns a file path that will be automatically attached to the Discord response. Use this when the user asks you to create, draw, generate, or make an image/picture/illustration. You can also use this proactively for visual humor, illustrating concepts, or creative expression.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate. Be specific about style, content, colors, composition.'
        },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Aspect ratio (default: 1:1). Use 16:9 for landscapes, 9:16 for portraits, etc.'
        }
      },
      required: ['prompt']
    }
  },
  // Skill builder is a built-in tool (core feature)
  skillBuilder.toolDefinition
];

// Execute a built-in tool
async function executeBuiltIn(name, input) {
  const cfg = loadConfig();

  switch (name) {
    case 'memory_read': {
      const longTerm = memory.readLongTermMemory();
      const dailyLogs = memory.loadRecentDailyLogs(input.daysBack || 2);
      return { longTermMemory: longTerm, recentDailyLogs: dailyLogs };
    }

    case 'memory_write':
      memory.writeLongTermMemory(input.content);
      return { success: true, message: 'Long-term memory updated.' };

    case 'memory_append_daily':
      memory.appendDailyLog(input.entry);
      return { success: true, message: 'Daily log entry added.' };

    case 'memory_search': {
      // Try hybrid search first, fall back to keyword search
      try {
        const { hybridSearch } = await import('./memory-index.js');
        const results = await hybridSearch(input.query);
        return { results };
      } catch (err) {
        // Hybrid search unavailable — fall back to basic keyword search
        console.warn('[Tools] Hybrid search unavailable, using keyword fallback:', err.message);
        const results = memory.searchMemory(input.query);
        return { results, note: 'Used keyword search (hybrid search unavailable)' };
      }
    }

    case 'calendar_list_events':
      return await calendar.listEvents(input.maxResults, input.daysAhead);

    case 'calendar_create_event':
      return await calendar.createEvent(input);

    case 'calendar_delete_event':
      return await calendar.deleteEvent(input.eventId);

    case 'calendar_update_event':
      return await calendar.updateEvent(input.eventId, input);

    case 'skill_execute': {
      // Execute a custom skill handler
      const skillName = input.skillName;
      const skillDir = path.join(SKILLS_DIR, skillName);
      const handlerPath = path.join(skillDir, 'handler.js');

      if (!fs.existsSync(handlerPath)) {
        return { error: `Skill "${skillName}" not found or has no handler.js` };
      }

      try {
        const handlerUrl = `file:///${handlerPath.replace(/\\/g, '/')}?t=${Date.now()}`;
        const mod = await import(handlerUrl);
        if (mod.execute) {
          return await mod.execute(input);
        }
        return { error: `Skill "${skillName}" handler has no execute function` };
      } catch (err) {
        return { error: `Skill execution failed: ${err.message}` };
      }
    }

    case 'model_switcher': {
      const MODEL_MAP = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-5-20250929',
        haiku: 'claude-haiku-4-5-20251001'
      };

      if (input.action === 'current') {
        return { currentModel: getModel() };
      }
      if (input.action === 'list') {
        return { models: MODEL_MAP, currentModel: getModel() };
      }
      if (input.action === 'switch') {
        if (!input.modelName || !MODEL_MAP[input.modelName]) {
          return { error: 'Invalid model name. Use: opus, sonnet, or haiku' };
        }
        const fullModelId = MODEL_MAP[input.modelName];
        const result = setModel(fullModelId);
        return { success: true, message: result, newModel: fullModelId };
      }

      return { error: 'Unknown action' };
    }

    case 'generate_image': {
      if (!isGeminiEnabled()) {
        return { error: 'Image generation unavailable — no GEMINI_API_KEY configured.' };
      }
      const result = await generateImage(input.prompt, input.aspectRatio || '1:1');

      // Schedule cleanup of old temp files (non-blocking)
      setTimeout(() => cleanupTempFiles(), 5000);

      return result;
    }

    default:
      throw new Error(`Unknown built-in tool: ${name}`);
  }
}

// Load custom skills from the skills/ directory
async function loadCustomSkillsAsync() {
  const customTools = [];
  const customHandlers = {};

  if (!fs.existsSync(SKILLS_DIR)) {
    return { customTools, customHandlers };
  }

  try {
    const skillDirs = fs.readdirSync(SKILLS_DIR);

    for (const skillName of skillDirs) {
      const skillDir = path.join(SKILLS_DIR, skillName);
      const handlerPath = path.join(skillDir, 'handler.js');

      if (!fs.existsSync(handlerPath)) continue;

      try {
        // Cache-bust by appending timestamp query
        const handlerUrl = `file:///${handlerPath.replace(/\\/g, '/')}?t=${Date.now()}`;
        const mod = await import(handlerUrl);

        if (mod.toolDefinition && mod.execute) {
          customTools.push(mod.toolDefinition);
          customHandlers[mod.toolDefinition.name] = mod.execute;
          console.log(`[Skills] Loaded: ${skillName} (${mod.toolDefinition.name})`);
        } else {
          console.warn(`[Skills] Invalid handler in ${skillName}: missing toolDefinition or execute`);
        }
      } catch (err) {
        console.error(`[Skills] Failed to load ${skillName}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Skills] Error loading custom skills:', err.message);
  }

  return { customTools, customHandlers };
}

// Main export: get all tools and cache custom handlers
let cachedCustomHandlers = {};

export async function getAllTools() {
  const { customTools, customHandlers } = await loadCustomSkillsAsync();
  cachedCustomHandlers = customHandlers;
  return [...builtInTools, ...customTools];
}

export async function executeTool(name, input) {
  // Try built-in first
  if (builtInTools.some(t => t.name === name)) {
    return await executeBuiltIn(name, input);
  }

  // Try custom skill
  if (cachedCustomHandlers[name]) {
    return await cachedCustomHandlers[name](input);
  }

  throw new Error(`Unknown tool: ${name}`);
}