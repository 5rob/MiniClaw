// src/skill-builder.js
// The meta-tool for building new skills (OpenClaw-style)
import fs from 'fs';
import path from 'path';

const SKILLS_DIR = path.resolve('skills');
fs.mkdirSync(SKILLS_DIR, { recursive: true });

export const toolDefinition = {
  name: 'skill_builder',
  description: `Manage custom skill/tool projects. Use this to create new skills, update existing ones, read their progress, and list all skill projects.
Each skill is a folder in skills/ with: SKILL.md (instructions), handler.js (executable logic), PROGRESS.md (dev notes), and an optional data/ folder.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'update_handler', 'update_skill_md', 'update_progress', 'read_project', 'list_projects', 'read_file', 'write_data_file'],
        description: 'What to do'
      },
      skillName: {
        type: 'string',
        description: 'The skill folder name (kebab-case, e.g. "shopping-list")'
      },
      content: {
        type: 'string',
        description: 'File content for create/update operations'
      },
      fileName: {
        type: 'string',
        description: 'For read_file/write_data_file: relative path within the skill folder'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action, skillName, content, fileName } = input;

  try {
    switch (action) {
      case 'list_projects': {
        if (!fs.existsSync(SKILLS_DIR)) return { projects: [] };

        const projects = fs.readdirSync(SKILLS_DIR)
          .filter(d => fs.statSync(path.join(SKILLS_DIR, d)).isDirectory())
          .map(name => {
            const progressPath = path.join(SKILLS_DIR, name, 'PROGRESS.md');
            const hasHandler = fs.existsSync(path.join(SKILLS_DIR, name, 'handler.js'));
            const progress = fs.existsSync(progressPath)
              ? fs.readFileSync(progressPath, 'utf-8')
              : '(no progress file)';

            return {
              name,
              hasHandler,
              latestProgress: progress.slice(-500)
            };
          });

        return { projects };
      }

      case 'create': {
        if (!skillName) throw new Error('skillName required');

        const skillDir = path.join(SKILLS_DIR, skillName);
        const dataDir = path.join(skillDir, 'data');

        if (fs.existsSync(skillDir)) {
          throw new Error(`Skill "${skillName}" already exists. Use read_project to view it.`);
        }

        fs.mkdirSync(dataDir, { recursive: true });

        // Create PROGRESS.md
        const now = new Date().toISOString();
        fs.writeFileSync(
          path.join(skillDir, 'PROGRESS.md'),
          `# ${skillName} — Development Progress\n\n## ${now}\n- Project created\n- Status: In Development\n\n`
        );

        // Create placeholder SKILL.md
        fs.writeFileSync(
          path.join(skillDir, 'SKILL.md'),
          content || `# ${skillName}\n\nDescription: (fill in)\n\n## When to use\n(fill in)\n\n## Example phrases\n- (fill in)\n`
        );

        // Create placeholder handler.js
        const toolName = skillName.replace(/-/g, '_');
        fs.writeFileSync(
          path.join(skillDir, 'handler.js'),
          `// ${skillName} — custom skill handler
// This file exports: toolDefinition (Anthropic tool schema) and execute(input)

export const toolDefinition = {
  name: '${toolName}',
  description: 'TODO: Describe what this tool does',
  input_schema: {
    type: 'object',
    properties: {
      // TODO: Define input parameters
    },
    required: []
  }
};

export async function execute(input) {
  // TODO: Implement tool logic
  return { message: 'Not yet implemented' };
}
`
        );

        return {
          success: true,
          message: `Skill project "${skillName}" created at skills/${skillName}/`
        };
      }

      case 'update_handler': {
        if (!skillName || !content) throw new Error('skillName and content required');

        const handlerPath = path.join(SKILLS_DIR, skillName, 'handler.js');
        if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
          throw new Error(`Skill "${skillName}" not found`);
        }

        fs.writeFileSync(handlerPath, content);
        return { success: true, message: `handler.js updated for "${skillName}"` };
      }

      case 'update_skill_md': {
        if (!skillName || !content) throw new Error('skillName and content required');

        const skillMdPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
        if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
          throw new Error(`Skill "${skillName}" not found`);
        }

        fs.writeFileSync(skillMdPath, content);
        return { success: true, message: `SKILL.md updated for "${skillName}"` };
      }

      case 'update_progress': {
        if (!skillName || !content) throw new Error('skillName and content required');

        const progressPath = path.join(SKILLS_DIR, skillName, 'PROGRESS.md');
        if (!fs.existsSync(path.join(SKILLS_DIR, skillName))) {
          throw new Error(`Skill "${skillName}" not found`);
        }

        const now = new Date().toISOString();
        fs.appendFileSync(progressPath, `\n## ${now}\n${content}\n`);
        return { success: true, message: `Progress updated for "${skillName}"` };
      }

      case 'read_project': {
        if (!skillName) throw new Error('skillName required');

        const skillDir = path.join(SKILLS_DIR, skillName);
        if (!fs.existsSync(skillDir)) {
          throw new Error(`Skill "${skillName}" not found`);
        }

        const files = {};
        for (const file of ['SKILL.md', 'handler.js', 'PROGRESS.md']) {
          const p = path.join(skillDir, file);
          files[file] = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
        }

        // List data files
        const dataDir = path.join(skillDir, 'data');
        files.dataFiles = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];

        return files;
      }

      case 'read_file': {
        if (!skillName || !fileName) throw new Error('skillName and fileName required');

        const filePath = path.join(SKILLS_DIR, skillName, fileName);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${fileName}`);
        }

        return { content: fs.readFileSync(filePath, 'utf-8') };
      }

      case 'write_data_file': {
        if (!skillName || !fileName || content === undefined) {
          throw new Error('skillName, fileName, and content required');
        }

        const filePath = path.join(SKILLS_DIR, skillName, 'data', fileName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);

        return { success: true, message: `Data file written: ${fileName}` };
      }

      default:
        throw new Error(`Unknown skill_builder action: ${action}`);
    }
  } catch (err) {
    console.error('[SkillBuilder] Error:', err.message);
    throw err;
  }
}
