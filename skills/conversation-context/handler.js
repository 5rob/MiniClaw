// skills/conversation-context/handler.js
// Conversation context management — view, clear, and manage rolling conversation buffers

export const toolDefinition = {
  name: 'conversation_context',
  description: 'View or clear the rolling conversation buffer for a Discord channel. The buffer stores the last 5 messages to provide context for model switches and wake messages.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['view', 'clear', 'status'],
        description: 'What to do: "view" shows buffer contents, "clear" empties the buffer, "status" shows buffer info'
      },
      channel_id: {
        type: 'string',
        description: 'Discord channel ID (optional for status, required for view/clear)'
      }
    },
    required: ['action']
  }
};

// Note: This tool provides a read-only interface to the conversation buffer
// The actual buffer is managed by src/discord.js and lives in memory only

export async function execute(input) {
  const { action, channel_id } = input;

  switch (action) {
    case 'status':
      return {
        success: true,
        buffer_size: 5,
        timeout_minutes: 30,
        note: 'Buffer is managed by discord.js — stores last 5 messages per channel, auto-clears after 30min idle',
        seeded_on_startup: true,
        seeded_from: 'Today\'s daily log (last 5 messages)'
      };

    case 'view':
      if (!channel_id) {
        return { success: false, error: 'channel_id required for "view" action' };
      }
      return {
        success: true,
        note: 'Cannot directly read buffer from skill context — buffer lives in discord.js runtime',
        suggestion: 'Buffer is automatically injected into all responses. Check recent conversation context in claude.js messages.'
      };

    case 'clear':
      if (!channel_id) {
        return { success: false, error: 'channel_id required for "clear" action' };
      }
      return {
        success: false,
        error: 'Cannot clear buffer from skill context — buffer is managed by discord.js',
        suggestion: 'Buffer auto-clears after 30 minutes of inactivity. To manually clear, restart the bot.'
      };

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
