// system-inspector — custom skill handler
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const toolDefinition = {
  name: 'system_inspector',
  description: 'Inspect the bot environment — list directory contents, read config files, check system info. Can also browse arbitrary directories on the host machine.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_root', 'read_config', 'read_env', 'list_dir', 'all'],
        description: 'What to inspect'
      },
      dirPath: {
        type: 'string',
        description: 'Absolute path to list (only used with list_dir action)'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action = 'list_root', dirPath } = input;

  const results = {
    action,
    timestamp: new Date().toISOString(),
    findings: {}
  };

  try {
    const rootDir = path.resolve(__dirname, '../..');
    results.findings.rootPath = rootDir;

    if (action === 'list_root' || action === 'all') {
      try {
        results.findings.rootContents = fs.readdirSync(rootDir);
      } catch (err) {
        results.findings.rootContents = `Error: ${err.message}`;
      }
    }

    if (action === 'list_dir') {
      if (!dirPath) return { success: false, error: 'dirPath required for list_dir' };
      try {
        results.findings.dirContents = fs.readdirSync(dirPath);
        results.findings.dirPath = dirPath;
      } catch (err) {
        results.findings.dirContents = `Error: ${err.message}`;
      }
    }

    if (action === 'read_env' || action === 'all') {
      const envPath = path.join(rootDir, '.env');
      try {
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          const masked = envContent.split('\n').map(line => {
            if (line.includes('KEY') || line.includes('SECRET') || line.includes('TOKEN')) {
              const [key] = line.split('=');
              return `${key}=***REDACTED***`;
            }
            return line;
          }).join('\n');
          results.findings.env = masked;
        } else {
          results.findings.env = 'No .env file found';
        }
      } catch (err) {
        results.findings.env = `Error: ${err.message}`;
      }
    }

    if (action === 'read_config' || action === 'all') {
      const configFiles = ['config.json', 'package.json', 'config.yaml', 'config.yml'];
      results.findings.configs = {};
      for (const configFile of configFiles) {
        const configPath = path.join(rootDir, configFile);
        try {
          if (fs.existsSync(configPath)) {
            results.findings.configs[configFile] = fs.readFileSync(configPath, 'utf8');
          }
        } catch (err) {
          results.findings.configs[configFile] = `Error: ${err.message}`;
        }
      }
    }

    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
}