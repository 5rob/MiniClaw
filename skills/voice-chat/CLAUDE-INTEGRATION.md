# Claude Haiku Integration Guide

The conversation loop currently uses an echo response. To integrate Claude Haiku for intelligent responses, follow these steps:

## 1. Install Anthropic SDK (if not already installed)

```bash
npm install @anthropic-ai/sdk
```

## 2. Add Import to handler.js

```javascript
import Anthropic from '@anthropic-ai/sdk';
```

## 3. Initialize Client

```javascript
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});
```

## 4. Replace Echo Response in startConversationLoop()

Find this section in `startConversationLoop()`:

```javascript
// Here we would normally call Claude Haiku for a response
// For now, we'll create a simple echo response
// TODO: Integrate with Claude API (Haiku model for fast responses)
const response = `I heard you say: ${transcription}`;
```

Replace with:

```javascript
// Get Claude Haiku response
await logEvent('DEBUG', 'Calling Claude Haiku for response', { transcription });

let response;
try {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // Fast, cost-effective model
    max_tokens: 150, // Keep responses concise for voice
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: transcription
      }
    ],
    system: 'You are a helpful voice assistant. Keep responses brief and conversational (1-3 sentences max). You are speaking via text-to-speech with an Australian accent.'
  });

  response = message.content[0].text;
  await logEvent('INFO', 'Claude Haiku response received', { response });
} catch (err) {
  await logEvent('ERROR', 'Claude API error', { error: err.message });
  response = "Sorry, I had trouble processing that.";
}
```

## 5. Optional: Add Conversation Context

For multi-turn conversations, maintain a conversation history:

```javascript
// Add to top of handler.js with other state variables
let conversationHistory = [];

// In startConversationLoop(), when calling Claude:
const message = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 150,
  temperature: 0.7,
  messages: [
    ...conversationHistory,
    {
      role: 'user',
      content: transcription
    }
  ],
  system: 'You are a helpful voice assistant...'
});

response = message.content[0].text;

// Update history
conversationHistory.push(
  { role: 'user', content: transcription },
  { role: 'assistant', content: response }
);

// Keep only last 10 turns to manage token usage
if (conversationHistory.length > 20) {
  conversationHistory = conversationHistory.slice(-20);
}

// Clear history when conversation loop stops
// In stopConversationLoop():
conversationHistory = [];
```

## 6. Environment Variable

Ensure `.env` has:

```bash
ANTHROPIC_API_KEY=your_api_key_here
```

## Cost Considerations

- **Haiku model**: ~$0.25 per million input tokens, ~$1.25 per million output tokens
- **Typical conversation turn**: ~50 input tokens + ~50 output tokens ≈ $0.00008 per turn
- **1000 turns**: ~$0.08

## Response Time Optimization

For even faster responses:
1. Set `max_tokens: 100` for shorter responses
2. Use streaming (more complex but real-time):
   ```javascript
   const stream = await anthropic.messages.stream({...});
   for await (const chunk of stream) {
     // Append to response as chunks arrive
   }
   ```
3. Consider caching system prompt (Anthropic prompt caching)

## Error Handling

The implementation above includes:
- Try-catch for API errors
- Fallback response if Claude fails
- Logging for debugging
- Graceful degradation

## Testing

1. Start conversation loop: `start_conversation`
2. Speak: "What's the weather like?"
3. Verify Claude responds intelligently (not echo)
4. Test error case: temporarily set wrong API key, verify fallback works
5. Test multi-turn: ask follow-up questions, verify context maintained

## Task Delegation (Future)

For complex requests that need more intelligence:

```javascript
// Classify intent
const isSimple = transcription.length < 50 && !containsComplexWords(transcription);

if (isSimple) {
  // Use Haiku for fast response
  model = 'claude-haiku-4-5-20251001';
} else {
  // Use Sonnet/Opus for complex tasks
  model = 'claude-sonnet-4-5-20250929';
  // Optionally: process in background, send TTS notification when done
}
```
