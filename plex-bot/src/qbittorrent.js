/**
 * qBittorrent Web API client
 */

const QBITTORRENT_URL = process.env.QBITTORRENT_URL;
const QBITTORRENT_USERNAME = process.env.QBITTORRENT_USERNAME;
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD;
const POLL_INTERVAL = (parseInt(process.env.POLL_INTERVAL_SECONDS) || 30) * 1000;

let authCookie = null;

/**
 * Authenticate with qBittorrent and get a session cookie
 */
async function authenticate() {
  const url = `${QBITTORRENT_URL}/api/v2/auth/login`;
  const params = new URLSearchParams({
    username: QBITTORRENT_USERNAME,
    password: QBITTORRENT_PASSWORD,
  });

  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (res.status !== 200) {
    throw new Error(`qBittorrent auth failed: ${res.status}`);
  }

  const cookie = res.headers.get('set-cookie');
  if (!cookie) {
    throw new Error('qBittorrent did not return a session cookie');
  }

  authCookie = cookie.split(';')[0]; // Extract just the SID part
  console.log('✅ Authenticated with qBittorrent');
}

/**
 * Add a magnet link to qBittorrent
 */
export async function addTorrent(magnetLink, type) {
  if (!authCookie) await authenticate();

  const url = `${QBITTORRENT_URL}/api/v2/torrents/add`;
  const params = new URLSearchParams({
    urls: magnetLink,
  });

  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': authCookie,
    },
  });

  if (res.status !== 200) {
    throw new Error(`Failed to add torrent: ${res.status}`);
  }

  const text = await res.text();
  if (text !== 'Ok.') {
    throw new Error(`qBittorrent rejected torrent: ${text}`);
  }

  console.log('✅ Torrent added to qBittorrent');

  // Extract torrent name from magnet link (dn= parameter)
  const nameMatch = magnetLink.match(/dn=([^&]+)/);
  const torrentName = nameMatch ? decodeURIComponent(nameMatch[1]) : null;

  return torrentName;
}

/**
 * Poll qBittorrent for download completion
 */
export function pollDownload(torrentName, callback) {
  let attempts = 0;
  const maxAttempts = 2880; // 24 hours at 30-second intervals

  const interval = setInterval(async () => {
    attempts++;

    try {
      if (!authCookie) await authenticate();

      const url = `${QBITTORRENT_URL}/api/v2/torrents/info`;
      const res = await fetch(url, {
        headers: { 'Cookie': authCookie },
      });

      const torrents = await res.json();

      // Find the torrent by name (partial match since magnet dn= might not be exact)
      const torrent = torrents.find((t) => torrentName && t.name.includes(torrentName));

      if (!torrent) {
        console.log(`⏳ Waiting for torrent to appear in qBittorrent...`);
        return;
      }

      console.log(`📊 ${torrent.name}: ${(torrent.progress * 100).toFixed(1)}% [${torrent.state}]`);

      // Check if complete
      if (torrent.progress >= 1.0 && torrent.state === 'uploading') {
        clearInterval(interval);
        console.log(`✅ Download complete: ${torrent.name}`);
        callback(true);
        return;
      }

      // Check if stalled (no seeds, no progress)
      if (torrent.state === 'stalledDL' || (torrent.num_seeds === 0 && attempts > 10)) {
        clearInterval(interval);
        console.log(`⚠️ Download stalled: ${torrent.name}`);
        callback(false);
        return;
      }

      // Timeout after max attempts
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.log(`⏱️ Download timeout: ${torrent.name}`);
        callback(false);
      }
    } catch (error) {
      console.error('Error polling qBittorrent:', error.message);
    }
  }, POLL_INTERVAL);
}
