export const toolDefinition = {
  name: 'hello_world',
  description: 'Returns a friendly greeting with system information. Use when the user says hello, wants to test the skill, or asks to be greeted.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['greet'],
        description: 'The action to perform'
      },
      name: {
        type: 'string',
        description: 'Optional name to personalize the greeting'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action, name } = input;

  switch (action) {
    case 'greet': {
      const greeting = name ? `Hello, ${name}!` : 'Hello, World!';
      return {
        success: true,
        message: greeting,
        timestamp: new Date().toISOString(),
        node_version: process.version,
        skill: 'hello-world'
      };
    }
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}
