# Jackett Setup Guide

Jackett is a proxy server that aggregates torrent indexers and provides a unified API for searching. This makes torrent searching much cleaner and more reliable.

## Step 1: Download Jackett

Go to the Jackett releases page:  
👉 https://github.com/Jackett/Jackett/releases/latest

Download the appropriate version for your OS:
- **Windows:** `Jackett.Binaries.Windows.zip`
- **Mac:** `Jackett.Binaries.macOS.tar.gz`
- **Linux:** `Jackett.Binaries.LinuxAMDx64.tar.gz` (or ARM if applicable)

## Step 2: Install and Run

### Windows
1. Extract the zip file to a folder (e.g., `C:\Jackett`)
2. Run `JackettTray.exe` (adds Jackett to your system tray)
3. Jackett will auto-start on boot if you leave the tray icon running

### Mac/Linux
1. Extract the archive: `tar -xzf Jackett.Binaries.*.tar.gz`
2. Move to `/opt/jackett` (or wherever you want)
3. Run `./jackett` from the terminal
4. To run as a service (auto-start), follow the instructions printed when you first run it

Jackett will open in your browser automatically at `http://localhost:9117`

## Step 3: Configure Indexers

Indexers are torrent sites. You need to add at least one (but more is better).

1. In the Jackett web interface, click **Add indexer** (top right)
2. Search for popular public indexers:
   - **1337x** (reliable, no signup)
   - **The Pirate Bay** (classic, sometimes blocked)
   - **EZTV** (great for TV shows)
   - **RARBG** (shut down, but there are clones like RARBGx)
   - **YTS/YIFY** (movies only, great quality/size ratio)
3. Click the **+** button next to each indexer to add it
4. Some indexers require a CAPTCHA or account — follow the on-screen instructions
5. Once added, the indexer will appear in your **Configured Indexers** list

**Tip:** Add 5-10 indexers for best results. Jackett searches all of them at once.

## Step 4: Get Your API Key

1. In the Jackett web interface, look at the top right
2. You'll see **API Key:** followed by a long string like `abc123def456...`
3. Click the **Copy** button next to it
4. Save this — you'll need it for the bot

## Step 5: Test Search

1. In Jackett, click **Manual Search** (top center)
2. Enter a test query like `Inception 2010`
3. Click **Search Trackers**
4. You should see results from your configured indexers
5. If you see "No results", add more indexers or check if they're working (some go down)

## Step 6: Update `.env`

In your `plex-bot/.env` file, add:

```env
JACKETT_URL=http://localhost:9117
JACKETT_API_KEY=your_api_key_here
```

Paste the API key you copied in Step 4.

## Troubleshooting

### "Connection refused" error
- Make sure Jackett is running (check `http://localhost:9117` in your browser)
- On Windows, check that `JackettTray.exe` is running in the system tray
- On Mac/Linux, make sure the `jackett` process is running (`ps aux | grep jackett`)

### No search results
- Make sure you've added indexers (Step 3)
- Test the search in Jackett's web interface first
- Some indexers are geo-blocked — try adding more indexers from different sources

### Indexers not working
- Some indexers go offline or get blocked — this is normal
- Remove broken indexers and add new ones
- Jackett shows a ⚠️ warning icon next to broken indexers

### CAPTCHA/Cloudflare blocking
- Some indexers require a CAPTCHA solve — Jackett will prompt you
- Click the indexer's **wrench icon** → **Test** to trigger the CAPTCHA
- Complete the CAPTCHA in your browser
- Jackett stores the session cookie for future searches

## Advanced: Private Trackers (Optional)

If you have accounts on private trackers (IPTorrents, TorrentLeech, etc.), you can add them to Jackett for better quality and faster speeds.

1. Click **Add indexer** → search for your tracker
2. Enter your account credentials or API key (varies by tracker)
3. Click **Okay**

Private trackers often have strict rules — make sure you maintain your ratio (seed back what you download).

---

**Next:** Run the bot! (see main `README.md`)
