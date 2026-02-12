// skills/file-manager/handler.js
// File management with safety guardrails — protects live instance, allows staging edits
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = path.resolve('.');

// Protected paths — these are READ-ONLY (relative to project root)
const PROTECTED_PREFIXES = [
  'src',
  'skills',
  'memory',
  'node_modules',
  '.env',
  'SOUL.md',
  'IDENTITY.md'
];

// Paths that can never be read either (sensitive)
const BLOCKED_PATHS = ['.env'];

// Check if a resolved path is within the project
function isWithinProject(resolvedPath) {
  return resolvedPath.startsWith(PROJECT_ROOT);
}

// Check if a path is protected (live instance files)
function isProtected(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//,  '');
  return PROTECTED_PREFIXES.some(prefix => 
    normalized === prefix || normalized.startsWith(prefix + '/')
  );
}

// Check if a path is blocked from reading
function isBlocked(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//,  '');
  return BLOCKED_PATHS.some(blocked => 
    normalized === blocked || normalized.endsWith('/' + blocked)
  );
}

// Resolve and validate a path
function resolvePath(inputPath) {
  const resolved = path.resolve(PROJECT_ROOT, inputPath);
  if (!isWithinProject(resolved)) {
    throw new Error(`Access denied: path is outside the project directory`);
  }
  const relative = path.relative(PROJECT_ROOT, resolved);
  return { resolved, relative };
}

export const toolDefinition = {
  name: 'file_manager',
  description: 'Manage files within the MiniClaw project. Can read, write, copy, move, delete, and list files. Live source code is protected — building happens in staging/.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write', 'copy', 'move', 'delete', 'list'],
        description: 'The file operation to perform'
      },
      path: {
        type: 'string',
        description: 'Target file or directory path (relative to project root)'
      },
      content: {
        type: 'string',
        description: 'File content (for write action)'
      },
      destination: {
        type: 'string',
        description: 'Destination path (for copy and move actions)'
      },
      recursive: {
        type: 'boolean',
        description: 'For delete/copy of directories (default false)'
      }
    },
    required: ['action', 'path']
  }
};

export async function execute(action, params) {
  // Handle both direct params and nested params from skill_execute
  const op = action || params?.action;
  const targetPath = params?.path;
  const content = params?.content;
  const destination = params?.destination;
  const recursive = params?.recursive || false;

  if (!targetPath) {
    return { success: false, error: 'Missing required parameter: path' };
  }

  try {
    const { resolved, relative } = resolvePath(targetPath);

    switch (op) {
      case 'read': {
        if (isBlocked(relative)) {
          return { success: false, error: `Access denied: ${relative} is blocked for security` };
        }
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `File not found: ${relative}` };
        }
        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          return { success: false, error: `${relative} is a directory. Use 'list' action instead.` };
        }
        const fileContent = fs.readFileSync(resolved, 'utf-8');
        return { success: true, path: relative, content: fileContent, size: stat.size };
      }

      case 'write': {
        if (isProtected(relative)) {
          return { success: false, error: `Access denied: ${relative} is protected. Build in staging/ instead.` };
        }
        if (!content && content !== '') {
          return { success: false, error: 'Missing required parameter: content' };
        }
        // Ensure parent directory exists
        const dir = path.dirname(resolved);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, content);
        return { success: true, message: `Written to ${relative}`, size: Buffer.byteLength(content) };
      }

      case 'copy': {
        if (!destination) {
          return { success: false, error: 'Missing required parameter: destination' };
        }
        const dest = resolvePath(destination);
        
        // Check if destination is protected
        if (isProtected(dest.relative)) {
          return { success: false, error: `Access denied: cannot copy to ${dest.relative}. Live files are protected.` };
        }

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Source not found: ${relative}` };
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          if (!recursive) {
            return { success: false, error: 'Source is a directory. Set recursive: true to copy directories.' };
          }
          copyDirRecursive(resolved, dest.resolved);
        } else {
          fs.mkdirSync(path.dirname(dest.resolved), { recursive: true });
          fs.copyFileSync(resolved, dest.resolved);
        }
        return { success: true, message: `Copied ${relative} → ${dest.relative}` };
      }

      case 'move': {
        if (!destination) {
          return { success: false, error: 'Missing required parameter: destination' };
        }
        // Both source and destination must not be protected
        if (isProtected(relative)) {
          return { success: false, error: `Access denied: cannot move ${relative}. Live files are protected.` };
        }
        const dest = resolvePath(destination);
        if (isProtected(dest.relative)) {
          return { success: false, error: `Access denied: cannot move to ${dest.relative}. Live files are protected.` };
        }

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Source not found: ${relative}` };
        }

        fs.mkdirSync(path.dirname(dest.resolved), { recursive: true });
        fs.renameSync(resolved, dest.resolved);
        return { success: true, message: `Moved ${relative} → ${dest.relative}` };
      }

      case 'delete': {
        if (isProtected(relative)) {
          return { success: false, error: `Access denied: cannot delete ${relative}. Live files are protected.` };
        }

        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Not found: ${relative}` };
        }

        const stat = fs.statSync(resolved);
        if (stat.isDirectory()) {
          if (!recursive) {
            return { success: false, error: 'Target is a directory. Set recursive: true to delete directories.' };
          }
          fs.rmSync(resolved, { recursive: true });
        } else {
          fs.unlinkSync(resolved);
        }
        return { success: true, message: `Deleted ${relative}` };
      }

      case 'list': {
        if (!fs.existsSync(resolved)) {
          return { success: false, error: `Directory not found: ${relative}` };
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return { success: false, error: `${relative} is a file, not a directory` };
        }
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const items = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file'
        }));
        return { success: true, path: relative, items };
      }

      default:
        return { success: false, error: `Unknown action: ${op}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Helper: recursively copy a directory
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
