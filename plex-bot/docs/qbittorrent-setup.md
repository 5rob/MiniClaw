# qBittorrent Web UI Setup

This guide will walk you through enabling the qBittorrent Web UI so the bot can control downloads.

## Step 1: Install qBittorrent (if needed)

If you don't have qBittorrent installed yet:

- **Windows:** Download from https://www.qbittorrent.org/download.php
- **Mac:** `brew install qbittorrent`
- **Linux:** `sudo apt install qbittorrent` (or your distro's package manager)

## Step 2: Enable Web UI

1. Open qBittorrent
2. Go to **Tools → Options** (or **Preferences** on Mac)
3. Click the **Web UI** tab on the left
4. Check **"Enable Web UI"**
5. Set the port (default is `8080` — leave it unless you have a conflict)
6. Under **Authentication:**
   - Username: `admin` (or choose your own)
   - Password: Choose a strong password
7. **Optional but recommended:** Check "Bypass authentication for clients on localhost" if the bot runs on the same machine
8. Click **OK** to save

## Step 3: Test Access

1. Open your browser
2. Go to `http://localhost:8080`
3. Log in with the username/password you set
4. You should see the qBittorrent web interface

## Step 4: Configure Default Download Path

1. In qBittorrent, go to **Tools → Options → Downloads**
2. Set **"Default Save Path"** to your Plex media folder
   - Example: `D:\Media\Movies` or `/mnt/media/movies`
3. If you want separate paths for movies/TV, you can set up **Categories** (advanced, optional)
4. Click **OK**

## Step 5: Update `.env`

In your `plex-bot/.env` file, add:

```env
QBITTORRENT_URL=http://localhost:8080
QBITTORRENT_USERNAME=admin
QBITTORRENT_PASSWORD=your_password_here
```

## Troubleshooting

### "Connection refused" error
- Make sure qBittorrent is running
- Check that the Web UI is enabled (repeat Step 2)
- Verify the port (default `8080`) isn't blocked by a firewall

### "Authentication failed" error
- Double-check the username/password in your `.env` file
- Try logging into `http://localhost:8080` in your browser with the same credentials

### Downloads go to the wrong folder
- Check **Tools → Options → Downloads** in qBittorrent
- Set the **Default Save Path** to your Plex folder

## Advanced: Categories (Optional)

If you want separate folders for movies vs TV shows:

1. In the qBittorrent Web UI, go to **Categories** (bottom left)
2. Right-click in the categories list → **Add category**
3. Create two categories:
   - `movies` → Save path: `/path/to/plex/movies`
   - `tv` → Save path: `/path/to/plex/tv`
4. The bot can be updated to assign categories when adding torrents (requires code change)

For now, one folder is fine — Plex auto-detects movies vs TV.

---

**Next:** Set up Jackett (see `jackett-setup.md`)
