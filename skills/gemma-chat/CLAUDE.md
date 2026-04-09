# MiniClaw Skill Builder Context

You are building a skill for MiniClaw, a Discord bot that uses the Anthropic API with tool_use.

## Project Structure
- This skill goes in: `skills/gemma-chat/`
- Working directory: `C:\Users\5robm\OneDrive\Desktop\MiniClaw\staging\skills\gemma-chat`
- You should create: handler.js, SKILL.md, PROGRESS.md, and optionally data/

## Key Conventions
- ES modules only (import/export)
- handler.js must export `toolDefinition` and `execute(input)`
- Return objects from execute(), don't use console.log for output
- Use path.resolve() for all file paths (Windows compatibility)
- Errors: return { success: false, error: 'msg' } instead of throwing

## Do NOT
- Modify any files outside of `skills/gemma-chat/`
- Install npm packages (use only Node.js built-ins + what's already installed)
- Create test files or configuration outside the skill folder
- Use require() — this project uses ES modules
