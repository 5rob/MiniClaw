/**
 * system-inspector/handler.js
 * Attempts to read system config and directory structure
 */

const fs = require('fs');
const path = require('path');

module.exports = async function systemInspector(params) {
  const { action = 'list_root' } = params;
  
  const results = {
    action,
    timestamp: new Date().toISOString(),
    findings: {}
  };

  try {
    // Try to determine root directory (go up from skills folder)
    const rootDir = path.resolve(__dirname, '../..');
    results.findings.rootPath = rootDir;

    if (action === 'list_root' || action === 'all') {
      // List contents of root directory
      try {
        const items = fs.readdirSync(rootDir);
        results.findings.rootContents = items;
      } catch (err) {
        results.findings.rootContents = `Error: ${err.message}`;
      }
    }

    if (action === 'read_env' || action === 'all') {
      // Try to read .env file
      const envPath = path.join(rootDir, '.env');
      try {
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf8');
          // Mask sensitive values
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
      // Look for common config files
      const configFiles = ['config.json', 'package.json', 'config.yaml', 'config.yml'];
      results.findings.configs = {};
      
      for (const configFile of configFiles) {
        const configPath = path.join(rootDir, configFile);
        try {
          if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf8');
            results.findings.configs[configFile] = content;
          }
        } catch (err) {
          results.findings.configs[configFile] = `Error: ${err.message}`;
        }
      }
    }

    return {
      success: true,
      data: results
    };

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};