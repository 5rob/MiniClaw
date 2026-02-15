# Plex Bot — Automated Media Downloader

A Discord bot that watches a channel for movie/TV requests and automatically downloads them via qBittorrent and Jackett.

## Features

- **Zero AI tokens** — fully deterministic parsing and searching
- **Quality filtering** — prefers WEBRip/BluRay 720p, blacklists CAM/TS versions
- **Release checking** — uses TMDB to verify digital availability
- **Auto-notification** — Discord messages when downloads start and complete
- **Failure handling** — clear error messages for obscure/unavailable content

## Setup

### 1. Prerequisites

- Node.js 18+ installed
- qBittorrent running with Web UI enabled (see `docs/qbittorrent-setup.md`)
- Jackett installed and configured (see `docs/jackett-setup.md`)
- TMDB API key (free registration at https://www.themoviedb.org/settings/api)
- Discord bot created (https://discord.com/developers/applications)

### 2. Installation

```bash
cd plex-bot
npm install
```

### 3. Configuration

1. Copy `.env.example` to `.env`
2. Fill in all the values (see setup guides in `docs/`)
3. Make sure qBittorrent and Jackett are running

### 4. Run

```bash
npm start
```

The bot will connect to Discord and start watching the configured channel.

## Usage

Nicole posts a message in the watched channel:

- **Movie:** `Blue Moon (2025)`
- **TV Episode:** `Breaking Bad S03E08`
- **TV Season:** `Seinfeld season 4`

The bot will:
1. Parse the request
2. Check TMDB for availability
3. Search Jackett for quality torrents
4. Send the best match to qBittorrent
5. Notify when the download completes

## Message Format Examples

**Success:**
```
⏳ Downloading 'Blue Moon (2025)' [WEBRip 720p, 1.2 GB]
✅ 'Blue Moon (2025)' is ready on Plex!
```

**Failures:**
```
❌ Couldn't find 'Obscure Film (2020)' on TMDB. Double-check the title/year?
🎬 'New Release (2025)' is still in cinemas — not available digitally yet.
❌ Found 'Blue Moon (2025)' but no quality torrents yet (only CAM/TS versions).
```

## Troubleshooting

- **Bot doesn't respond:** Check the channel ID in `.env` matches the channel you're posting in
- **"No torrents found":** Make sure Jackett is running and has indexers configured
- **Downloads don't start:** Check qBittorrent credentials and Web UI is enabled
- **"Still in cinemas":** The movie hasn't been released digitally yet — wait a few weeks

## Project Structure

```
plex-bot/
├── src/
│   ├── index.js          # Discord bot entry point
│   ├── parser.js         # Message parsing logic
│   ├── tmdb.js           # TMDB API client
│   ├── jackett.js        # Jackett torrent search
│   ├── qbittorrent.js    # qBittorrent API client
│   └── torrent-filter.js # Quality filtering
├── docs/
│   ├── qbittorrent-setup.md
│   └── jackett-setup.md
└── .env                  # Your configuration (not committed)
```

## Contributing

This is a personal project for Rob & Nicole. If you found this useful, feel free to fork and adapt!
