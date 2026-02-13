// file-reader — custom skill handler
// This file exports: toolDefinition (Anthropic tool schema) and execute(input)

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const toolDefinition = {
  name: 'file_reader',
  description: 'Read text files from the file-reader data folder. Can list available files or read specific ones.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read'],
        description: 'Either "list" files or "read" a specific file'
      },
      filename: {
        type: 'string',
        description: 'The filename to read (only needed for "read" action)'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const dataDir = path.join(__dirname, 'data');
  
  try {
    if (input.action === 'list') {
      const files = await fs.readdir(dataDir);
      return { 
        files: files.filter(f => !f.startsWith('.')),
        count: files.length 
      };
    }
    
    if (input.action === 'read') {
      if (!input.filename) {
        return { error: 'filename required for read action' };
      }
      
      const filepath = path.join(dataDir, input.filename);
      const content = await fs.readFile(filepath, 'utf-8');
      return { 
        filename: input.filename,
        content: content 
      };
    }
    
    return { error: 'Invalid action' };
    
  } catch (err) {
    return { error: err.message };
  }
}
