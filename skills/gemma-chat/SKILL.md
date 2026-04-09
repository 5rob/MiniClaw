# gemma-chat

Local LLM integration for MiniClaw using Google's Gemma 4 models via Ollama.

## Purpose

Reduce Claude API costs by offloading simple tasks to free local inference. Gemma 4 runs on your machine at zero cost per token.

## What It Does

- **!gemma command**: Switch to local Gemma 4 model instead of Claude
- **Cost tracking**: Logs token usage and estimated savings vs Claude
- **Tool support**: Gemma 4 supports function calling (can use MiniClaw tools)
- **Graceful fallback**: Clear error messages if Ollama isn't running

## When to Use

**Use Gemma for:**
- Simple questions ("What's the capital of France?")
- Code generation (Python functions, regex, etc.)
- Text summarization
- Quick explanations
- Draft writing

**Use Claude for:**
- Complex reasoning
- Tool orchestration (multiple steps)
- Mission-critical accuracy
- Nuanced conversation

## Prerequisites

1. **Install Ollama**: Download from https://ollama.com
2. **Pull Gemma 4**: Run `ollama pull gemma4:e4b` (recommended) or `ollama pull gemma4:31b` (more capable, slower)
3. **Start Ollama**: Should auto-start as a background service

## Actions

### chat
Send a message to local Gemma model.

**Parameters:**
- `message` (required): Your message/question
- `model` (optional): Model variant (e4b, 31b). Default: e4b
- `systemPrompt` (optional): Custom system instructions

**Example:**
```javascript
{
  action: 'chat',
  message: 'Write a Python function to parse JSON with error handling',
  model: 'e4b'
}
```

### status
Check if Ollama is running and what models are available.

**Example:**
```javascript
{
  action: 'status'
}
```

**Returns:**
```javascript
{
  success: true,
  running: true,
  baseUrl: 'http://localhost:11434',
  defaultModel: 'gemma4:e4b',
  availableGemmaModels: ['gemma4:e4b', 'gemma4:31b'],
  totalModels: 5
}
```

### usage
View token usage statistics and estimated cost savings.

**Example:**
```javascript
{
  action: 'usage'
}
```

**Returns:**
```javascript
{
  success: true,
  stats: {
    totalRequests: 42,
    totalTokens: 125000,
    byModel: {
      'gemma4:e4b': { requests: 35, tokens: 80000 },
      'gemma4:31b': { requests: 7, tokens: 45000 }
    },
    estimatedSavings: {
      tokensProcessedLocally: 125000,
      estimatedSavingsVsHaiku: '$0.0313',
      estimatedSavingsVsSonnet: '$0.3750'
    }
  }
}
```

## Discord Integration

The skill automatically hooks into the `!gemma` command in Discord:

**User:** `!gemma what's the weather like in Sydney?`  
**Bot:** *(processes with local Gemma 4 instead of Claude)*

## Environment Variables

- `OLLAMA_BASE_URL`: Ollama API endpoint (default: `http://localhost:11434`)
- `OLLAMA_DEFAULT_MODEL`: Default model variant (default: `gemma4:e4b`)
- `OLLAMA_TIMEOUT`: Request timeout in ms (default: `30000`)

## Available Models

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| gemma4:e4b | 4.5B active | Fast | Good | General tasks, quick answers |
| gemma4:31b | 30.7B | Slower | Better | Code generation, reasoning |

## Cost Savings Estimate

**Example monthly usage:**
- 100 Gemma requests/month
- 1000 tokens average per request
- Total: 100,000 tokens

**Savings:**
- vs Haiku: ~$0.025/month
- vs Sonnet: ~$0.30/month

*Small absolute numbers, but 100% of those tokens are free. Scales with usage.*

## Troubleshooting

**"Ollama is not running"**
→ Install from https://ollama.com and run `ollama serve` or restart your machine (auto-starts as service)

**"Model not found"**
→ Pull the model: `ollama pull gemma4:e4b`

**Slow responses**
→ Use smaller model (e4b instead of 31b) or upgrade GPU

**Quality not good enough**
→ Switch back to Claude with `!sonnet` or `!opus`

## Technical Details

- **API**: OpenAI-compatible REST endpoint (`/v1/chat/completions`)
- **Timeout**: 30s default (configurable)
- **Function calling**: Supported (Gemma 4 native capability)
- **Context window**: 128K (e4b), 256K (31b)
- **Usage tracking**: Persistent JSON log in `data/usage.json`

## Integration with Other Skills

Other MiniClaw skills can call Gemma directly:

```javascript
import { chat } from './skills/gemma-chat/handler.js';

const response = await chat([
  { role: 'user', content: 'Summarize this article...' }
], {
  model: 'e4b',
  temperature: 0.7
});

console.log(response.content);
```

## Future Enhancements

- Auto-routing based on message complexity (simple → Gemma, complex → Claude)
- Model auto-selection (e4b for speed, 31b for quality)
- Streaming responses for faster perceived latency
- Fine-tuning on Rob's conversation corpus (personalized LLM project)
