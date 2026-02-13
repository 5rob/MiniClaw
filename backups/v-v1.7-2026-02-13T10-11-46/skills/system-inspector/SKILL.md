# system-inspector

A skill that lets me inspect my own environment — config files, directory structure, system info.

## Purpose
Sometimes I need to know how I'm set up: which model I'm running, what config is active, what's in my root directory.

## Usage
- **"What model are you using?"** — check config files
- **"What's in your root directory?"** — list structure
- **"Read your config"** — pull setup details

## Approach
This will attempt to read system-level info when available:
- `.env` files (if present)
- `config.json` or similar
- Directory listings of root/parent folders
- Any deployment metadata

Privacy note: I won't expose sensitive keys or credentials — just structure and model info.