// staging/src/gemma.js
// Gemma integration layer — mirrors claude.js interface but routes to local Ollama
// Supports auto-upgrade to Claude when needed
// Strategy: Use Gemma ONLY for mechanical tasks (code gen, lookups), Claude for conversation

import { chat as gemmaChat } from '../skills/gemma-chat/handler.js';
import { chat as claudeChat, setModel as claudeSetModel, getModel as claudeGetModel } from './claude.js';
import { getAllTools } from './tools.js';

// Current routing state per channel
const channelRouting = new Map(); // channelId → 'gemma-e4b' | 'gemma-31b' | 'claude-sonnet' | 'claude-opus'

// Default models
const GEMMA_E4B = 'gemma-e4b';
const GEMMA_31B = 'gemma-31b';
const CLAUDE_SONNET = 'claude-sonnet';
const CLAUDE_OPUS = 'claude-opus';

// Model routing defaults
const DEFAULT_MODEL = CLAUDE_SONNET; // Claude by default for personality

/**
 * Set the active model for a channel
 */
export function setActiveModel(channelId, model) {
  channelRouting.set(channelId, model);
  console.log(`[Gemma Router] Channel ${channelId} set to: ${model}`);
}

/**
 * Get the active model for a channel (defaults to Claude Sonnet)
 */
export function getActiveModel(channelId) {
  return channelRouting.get(channelId) || DEFAULT_MODEL;
}

/**
 * Detect if message is PURELY mechanical (can use Gemma)
 * These are tasks with no personality/nuance needed
 */
function isMechanicalTask(messageContent) {
  const mechanicalPatterns = [
    // Math/logic
    /^what('?s| is) \d+[\+\-\*\/÷×]\d+/i,
    /^calculate /i,
    /^solve this:/i,
    
    // Simple code generation (single function, no context)
    /^write a (python|javascript|js|node|regex|sql) (function|script|query) to /i,
    /^generate a regex (for|to|that)/i,
    /^create a function that /i,
    
    // Simple factual lookups (no opinion needed)
    /^what is the (capital|population|currency) of /i,
    /^how many /i,
    /^when (did|was|were) /i,
    /^who (invented|created|founded) /i,
    /^define /i,
    /^explain (in technical terms|the algorithm|how .+ works)/i,
  ];

  for (const pattern of mechanicalPatterns) {
    if (pattern.test(messageContent)) return true;
  }

  return false;
}

/**
 * Detect if message needs code generation (E4B → 31B upgrade)
 */
function needsComplexCodeGeneration(messageContent) {
  const complexCodePatterns = [
    /write .+ (class|module|package|library|system)/i,
    /implement .+ (algorithm|pattern|architecture)/i,
    /refactor/i,
    /optimize/i,
    /debug/i,
  ];

  for (const pattern of complexCodePatterns) {
    if (pattern.test(messageContent)) return true;
  }

  return false;
}

/**
 * Detect if a message needs Claude instead of Gemma
 * Returns: 'opus', 'sonnet', or null
 */
function needsClaude(messageContent) {
  // Building/coding → Opus
  const buildPatterns = [
    /\blet'?s\s+(build|work on|tackle|get to work|implement|get #?\d)/i,
    /\bcan (you|we)\s+(build|implement|create a skill|create a tool|write|code|develop|set up|upgrade)/i,
    /\bstart\s+(building|coding|implementing|working)/i,
    /\bget\s+(this|that|it)\s+(built|done|implemented|working|going)/i,
    /\btime to\s+(build|code|work)/i,
    /\bgenerate.+prompt/i,
  ];

  for (const pattern of buildPatterns) {
    if (pattern.test(messageContent)) return 'opus';
  }

  // EXPLICIT tool trigger phrases (must be clear intent) → Sonnet
  const toolPatterns = [
    // Calendar
    /\b(what'?s on my|check my|show my|list my)\s+(calendar|schedule|appointments?|events?)/i,
    /\b(add|create|schedule|book)\s+(an?|to)\s+(calendar|event|appointment|meeting)/i,
    /\b(when is|when'?s)\s+(my|the)\s+(meeting|appointment|event)/i,
    
    // Reminders
    /\b(set|create|add)\s+a?\s*reminders?/i,
    /\bremind me\s+(to|about|in|at|tomorrow|next)/i,
    /\b(show|list|what)\s+(my\s+)?(pending\s+)?reminders?/i,
    
    // Memory
    /\b(remember|save|store|note|write down)\s+(this|that)/i,
    /\bwhat did (i|we|you)\s+(say|mention|tell)/i,
    /\bdo you (remember|recall|know about)/i,
    
    // Web search
    /\b(search|look up|find|google|browse|research)\s+(for|about|on)/i,
    
    // Image generation
    /\b(generate|create|make|draw)\s+(an?|some)?\s+(image|picture|photo|art|illustration)/i,
    
    // File operations
    /\b(read|write|edit|create|delete|list|show)\s+(the\s+)?(file|files)/i,
    
    // Process management
    /\b(promote|restart|deploy|build status|staging status)/i,
  ];

  for (const pattern of toolPatterns) {
    if (pattern.test(messageContent)) return 'sonnet';
  }

  // Conversational patterns (needs Claude for personality) → Sonnet
  const conversationalPatterns = [
    /\bhow (are you|you (doing|feeling)|'?s it going)/i,
    /\bwhat do you (think|feel|reckon)/i,
    /\btell me about/i,
    /\byour (opinion|thoughts|take) on/i,
    /\bi (think|feel|believe|reckon)/i,
    /\bdo you (like|prefer|enjoy)/i,
    /\b(thanks|thank you|cheers|appreciate)/i,
    /\b(hello|hi|hey|sup|yo)\b/i,
    /\b(bye|goodbye|see you|catch you|later)\b/i,
  ];

  for (const pattern of conversationalPatterns) {
    if (pattern.test(messageContent)) return 'sonnet';
  }

  // No upgrade needed
  return null;
}

/**
 * Main chat function — routes to Gemma or Claude based on context
 */
export async function chat(channelId, userMessage, conversationContext = null) {
  const currentModel = getActiveModel(channelId);

  // Check if user manually forced a model
  const userForcedModel = currentModel !== DEFAULT_MODEL;

  // Detect task type
  const isMechanical = isMechanicalTask(userMessage);
  const hasToolRequest = needsClaude(userMessage);
  const needsGemma31B = needsComplexCodeGeneration(userMessage);

  let targetModel = currentModel;
  let upgradedNotice = null;

  // Upgrade logic
  if (hasToolRequest === 'opus') {
    // Build mode → Opus
    targetModel = CLAUDE_OPUS;
    if (currentModel !== CLAUDE_OPUS) {
      upgradedNotice = '⚡ *Auto-upgraded to Claude Opus (build mode)*\n\n';
      setActiveModel(channelId, CLAUDE_OPUS);
      claudeSetModel('claude-opus-4-6');
    }
  } else if (hasToolRequest === 'sonnet') {
    // Tool use or conversation → Sonnet
    targetModel = CLAUDE_SONNET;
    if (currentModel !== CLAUDE_SONNET && !userForcedModel) {
      upgradedNotice = '⚡ *Auto-upgraded to Claude Sonnet (tool orchestration)*\n\n';
      setActiveModel(channelId, CLAUDE_SONNET);
      claudeSetModel('claude-sonnet-4-5-20250929');
    }
  } else if (isMechanical && !userForcedModel) {
    // Mechanical task → can use Gemma
    if (needsGemma31B) {
      targetModel = GEMMA_31B;
      upgradedNotice = '⚡ *Using Gemma 31B (complex code generation, local)*\n\n';
      setActiveModel(channelId, GEMMA_31B);
    } else {
      targetModel = GEMMA_E4B;
      upgradedNotice = '⚡ *Using Gemma E4B (mechanical task, local)*\n\n';
      setActiveModel(channelId, GEMMA_E4B);
    }
  } else if (!userForcedModel) {
    // Default to Claude Sonnet for conversation/nuanced tasks
    targetModel = CLAUDE_SONNET;
    if (currentModel !== CLAUDE_SONNET) {
      setActiveModel(channelId, CLAUDE_SONNET);
      claudeSetModel('claude-sonnet-4-5-20250929');
    }
  }

  console.log(`[Gemma Router] Using ${targetModel} for channel ${channelId}`);

  // Route to appropriate model
  let response;

  if (targetModel.startsWith('gemma-')) {
    const gemmaModel = targetModel === GEMMA_E4B ? 'e4b' : '31b';
    
    try {
      // Build system prompt for Gemma (minimal, task-focused)
      const systemPrompt = `You are a helpful AI assistant. Provide clear, accurate, concise responses to technical questions and tasks.`;

      const result = await gemmaChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], {
        model: gemmaModel,
        temperature: 0.7,
      });

      response = result.content;

      // Check if Gemma failed or gave poor response
      if (!response || response.length < 10 || response.includes('I apologize') || response.includes('I cannot')) {
        console.log('[Gemma Router] Gemma response poor, falling back to Claude Sonnet');
        upgradedNotice = '⚡ *Auto-upgraded to Claude Sonnet (Gemma fallback)*\n\n';
        setActiveModel(channelId, CLAUDE_SONNET);
        claudeSetModel('claude-sonnet-4-5-20250929');
        response = await claudeChat(channelId, userMessage, conversationContext);
      }

    } catch (error) {
      console.error('[Gemma Router] Gemma error:', error.message);
      console.log('[Gemma Router] Falling back to Claude Sonnet');
      upgradedNotice = '⚡ *Auto-upgraded to Claude Sonnet (Gemma offline)*\n\n';
      setActiveModel(channelId, CLAUDE_SONNET);
      claudeSetModel('claude-sonnet-4-5-20250929');
      response = await claudeChat(channelId, userMessage, conversationContext);
    }

  } else {
    // Claude mode
    response = await claudeChat(channelId, userMessage, conversationContext);
  }

  // Prepend upgrade notice if we switched models
  if (upgradedNotice) {
    response = upgradedNotice + response;
  }

  return response;
}

/**
 * Manual model switching commands
 */
export function forceGemmaE4B(channelId) {
  setActiveModel(channelId, GEMMA_E4B);
  return 'Switched to **Gemma E4B** ⚡ (fast local model — no API costs)\n\n*Note: Gemma is best for mechanical tasks. For conversation, consider Claude Sonnet (!sonnet)*';
}

export function forceGemma31B(channelId) {
  setActiveModel(channelId, GEMMA_31B);
  return 'Switched to **Gemma 31B** 🧠 (high-quality local model — no API costs)\n\n*Note: Gemma is best for mechanical tasks. For conversation, consider Claude Sonnet (!sonnet)*';
}

export function forceSonnet(channelId) {
  setActiveModel(channelId, CLAUDE_SONNET);
  claudeSetModel('claude-sonnet-4-5-20250929');
  return 'Switched to **Claude Sonnet** 🎵 (balanced, tool-capable, personality-rich)';
}

export function forceOpus(channelId) {
  setActiveModel(channelId, CLAUDE_OPUS);
  claudeSetModel('claude-opus-4-6');
  return 'Switched to **Claude Opus** 🔥 (full power, build mode)';
}

/**
 * Get current model status
 */
export function getModelStatus(channelId) {
  const active = getActiveModel(channelId);
  const modelLabels = {
    [GEMMA_E4B]: 'Gemma E4B ⚡ (local, free)',
    [GEMMA_31B]: 'Gemma 31B 🧠 (local, free)',
    [CLAUDE_SONNET]: 'Claude Sonnet 🎵 (API, tool-capable)',
    [CLAUDE_OPUS]: 'Claude Opus 🔥 (API, build mode)',
  };

  return `Current model: **${modelLabels[active] || active}**`;
}
