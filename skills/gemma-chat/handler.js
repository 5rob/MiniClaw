/**
 * Gemma Chat — Local LLM integration via Ollama
 * 
 * Provides !gemma command for cost-free local inference using Gemma 4 models.
 * Coexists with existing Claude model switcher (opus/sonnet/haiku).
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_DEFAULT_MODEL || 'gemma4:e4b';
const OLLAMA_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT) || 30000; // 30s

// Usage tracking
const USAGE_LOG_PATH = path.resolve(__dirname, 'data', 'usage.json');

/**
 * Tool definition for MiniClaw's tool orchestration
 */
export const toolDefinition = {
  name: 'gemma_chat',
  description: 'Chat with local Gemma 4 model via Ollama (free, no API costs). Use for simple tasks, code generation, summaries. Falls back to Claude if Ollama offline.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['chat', 'status', 'usage'],
        description: 'Action: chat (send message to Gemma), status (check if Ollama running), usage (view stats)',
      },
      message: {
        type: 'string',
        description: 'Message to send to Gemma (required for chat action)',
      },
      model: {
        type: 'string',
        description: 'Gemma model variant (e4b, 31b, etc). Default: e4b',
      },
      systemPrompt: {
        type: 'string',
        description: 'Optional system prompt to guide Gemma behavior',
      },
    },
    required: ['action'],
  },
};

/**
 * Execute the tool
 */
export async function execute({ action, message, model, systemPrompt }) {
  switch (action) {
    case 'chat':
      return await chatWithGemma(message, model, systemPrompt);
    case 'status':
      return await checkOllamaStatus();
    case 'usage':
      return await getUsageStats();
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

/**
 * Chat with Gemma via Ollama
 */
async function chatWithGemma(userMessage, modelVariant = OLLAMA_DEFAULT_MODEL, systemPrompt = null) {
  if (!userMessage) {
    return { success: false, error: 'Message is required for chat action' };
  }

  const modelName = modelVariant.startsWith('gemma4:') ? modelVariant : `gemma4:${modelVariant}`;
  
  try {
    const messages = [];
    
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push({ role: 'user', content: userMessage });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 64, // Gemma 4 best practices from documentation
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    // Track usage
    await logUsage({
      model: modelName,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    });

    return {
      success: true,
      response: data.choices[0].message.content,
      model: modelName,
      usage: data.usage,
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: `Gemma request timed out after ${OLLAMA_TIMEOUT/1000}s. Try a simpler query or check Ollama status.`,
      };
    }

    // Check if it's a connection error (Ollama not running)
    if (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed')) {
      return {
        success: false,
        error: 'Ollama is not running. Install it from https://ollama.com and run: ollama pull gemma4:e4b',
        needsOllama: true,
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Check if Ollama is running and what models are available
 */
async function checkOllamaStatus() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API returned ${response.status}`);
    }

    const data = await response.json();
    const gemmaModels = data.models?.filter(m => m.name.startsWith('gemma4')) || [];

    return {
      success: true,
      running: true,
      baseUrl: OLLAMA_BASE_URL,
      defaultModel: OLLAMA_DEFAULT_MODEL,
      availableGemmaModels: gemmaModels.map(m => m.name),
      totalModels: data.models?.length || 0,
    };

  } catch (error) {
    return {
      success: true, // Not a skill error, just reporting status
      running: false,
      baseUrl: OLLAMA_BASE_URL,
      error: 'Ollama is not running or not reachable',
      installInstructions: 'Download from https://ollama.com, then run: ollama pull gemma4:e4b',
    };
  }
}

/**
 * Get usage statistics
 */
async function getUsageStats() {
  try {
    await ensureDataDir();
    
    let stats;
    try {
      const content = await fs.readFile(USAGE_LOG_PATH, 'utf-8');
      stats = JSON.parse(content);
    } catch {
      stats = { totalRequests: 0, totalTokens: 0, byModel: {} };
    }

    return {
      success: true,
      stats: {
        totalRequests: stats.totalRequests || 0,
        totalTokens: stats.totalTokens || 0,
        byModel: stats.byModel || {},
        estimatedSavings: calculateSavings(stats),
      },
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Log usage for tracking token savings
 */
async function logUsage({ model, promptTokens, completionTokens, totalTokens }) {
  try {
    await ensureDataDir();

    let stats;
    try {
      const content = await fs.readFile(USAGE_LOG_PATH, 'utf-8');
      stats = JSON.parse(content);
    } catch {
      stats = { totalRequests: 0, totalTokens: 0, byModel: {} };
    }

    stats.totalRequests = (stats.totalRequests || 0) + 1;
    stats.totalTokens = (stats.totalTokens || 0) + totalTokens;

    if (!stats.byModel[model]) {
      stats.byModel[model] = { requests: 0, tokens: 0 };
    }
    stats.byModel[model].requests += 1;
    stats.byModel[model].tokens += totalTokens;

    await fs.writeFile(USAGE_LOG_PATH, JSON.stringify(stats, null, 2));

  } catch (error) {
    console.error('Failed to log Gemma usage:', error);
  }
}

/**
 * Calculate estimated cost savings vs Claude
 */
function calculateSavings(stats) {
  const totalTokens = stats.totalTokens || 0;
  
  // Rough pricing (per 1M tokens)
  const haikuCost = 0.25;  // $0.25 per 1M input tokens
  const sonnetCost = 3.00; // $3.00 per 1M input tokens
  
  // Conservative estimate: assume these requests would've used Haiku
  const savedVsHaiku = (totalTokens / 1_000_000) * haikuCost;
  const savedVsSonnet = (totalTokens / 1_000_000) * sonnetCost;

  return {
    tokensProcessedLocally: totalTokens,
    estimatedSavingsVsHaiku: `$${savedVsHaiku.toFixed(4)}`,
    estimatedSavingsVsSonnet: `$${savedVsSonnet.toFixed(4)}`,
  };
}

/**
 * Ensure data directory exists
 */
async function ensureDataDir() {
  const dataDir = path.resolve(__dirname, 'data');
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/**
 * Chat function for direct integration (non-tool use)
 * This allows other parts of MiniClaw to call Gemma directly
 */
export async function chat(messages, options = {}) {
  const {
    model = OLLAMA_DEFAULT_MODEL,
    tools = null,
    temperature = 1.0,
    topP = 0.95,
    topK = 64,
  } = options;

  const modelName = model.startsWith('gemma4:') ? model : `gemma4:${model}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

    const requestBody = {
      model: modelName,
      messages,
      temperature,
      top_p: topP,
      top_k: topK,
    };

    // Add tools if provided (Gemma 4 supports function calling)
    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Track usage
    await logUsage({
      model: modelName,
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    });

    return {
      content: data.choices[0].message.content,
      toolCalls: data.choices[0].message.tool_calls || null,
      usage: data.usage,
      model: modelName,
    };

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${OLLAMA_TIMEOUT/1000}s`);
    }
    throw error;
  }
}
