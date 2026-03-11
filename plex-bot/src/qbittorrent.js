/**
 * qBittorrent Web API client
 */

const POLL_INTERVAL_MS = (parseInt(process.env.POLL_INTERVAL_SECONDS) || 30) * 1000;

let authCookie = null;

function getConfig() {
  return {
    url: process.env.QBITTORRENT_URL || 'http://localhost:8080',
    username: process.env.QBITTORRENT_USERNAME || 'admin',
    password: process.env.QBITTORRENT_PASSWORD || '',
  };
}

/**
 * Authenticate with qBittorrent and get a session cookie
 */
async function authenticate() {
  const config = getConfig();
  const url = `${config.url}/api/v2/auth/login`;

  console.log(`🔐 Authenticating with qBittorrent at ${config.url}...`);
  console.log(`   Username: ${config.username}, Password: ${config.password ? '***' : '(empty)'}`);

  const params = new URLSearchParams({
    username: config.username,
    password: config.password,
  });

  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const responseText = await res.text();
  console.log(`📡 qBittorrent auth response: ${res.status} — "${responseText}"`);

  if (res.status !== 200) {
    throw new Error(`qBittorrent auth failed: ${res.status} — ${responseText}`);
  }

  if (responseText === 'Fails.') {
    throw new Error('qBittorrent auth failed: wrong username or password');
  }

  const cookie = res.headers.get('set-cookie');
  if (!cookie) {
    throw new Error('qBittorrent did not return a session cookie');
  }

  authCookie = cookie.split(';')[0];
  console.log('✅ Authenticated with qBittorrent');
}

/**
 * Add a magnet link to qBittorrent
 */
export async function addTorrent(magnetLink, type) {
  if (!authCookie) await authenticate();

  const config = getConfig();
  const url = `${config.url}/api/v2/torrents/add`;
  const params = new URLSearchParams({
    urls: magnetLink,
  });

  console.log(`📤 Adding torrent to qBittorrent...`);

  const res = await fetch(url, {
    method: 'POST',
    body: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': authCookie,
    },
  });

  const text = await res.text();
  console.log(`📡 qBittorrent add response: ${res.status} — "${text}"`);

  if (res.status === 403) {
    // Session expired — re-auth and retry once
    console.log('🔄 Session expired, re-authenticating...');
    authCookie = null;
    await authenticate();

    const retryRes = await fetch(url, {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': authCookie,
      },
    });

    const retryText = await retryRes.text();
    console.log(`📡 qBittorrent retry response: ${retryRes.status} — "${retryText}"`);

    if (retryRes.status !== 200) {
      throw new Error(`Failed to add torrent after re-auth: ${retryRes.status} — ${retryText}`);
    }
  } else if (res.status !== 200) {
    throw new Error(`Failed to add torrent: ${res.status} — ${text}`);
  }

  console.log('✅ Torrent added to qBittorrent');

  // Extract torrent name from magnet link (dn= parameter)
  // Note: magnet links use + for spaces, but decodeURIComponent only handles %20
  const nameMatch = magnetLink.match(/dn=([^&]+)/);
  const torrentName = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : null;

  return torrentName;
}

/**
 * Poll qBittorrent for download completion
 * @param {string} torrentName - Name to match against
 * @param {function} callback - Called with (success, torrentName) when done
 * @param {function} onProgress - Called with ({name, progress, state}) on each poll
 */
export function pollDownload(torrentName, callback, onProgress) {
  let attempts = 0;
  const maxAttempts = 2880; // 24 hours at 30-second intervals

  const interval = setInterval(async () => {
    attempts++;

    try {
      if (!authCookie) await authenticate();

      const config = getConfig();
      const url = `${config.url}/api/v2/torrents/info`;
      const res = await fetch(url, {
        headers: { 'Cookie': authCookie },
      });

      if (res.status === 403) {
        console.log('🔄 Session expired during poll, re-authenticating...');
        authCookie = null;
        return; // Will re-auth on next poll
      }

      const torrents = await res.json();

      // Debug: show all torrents on first attempt
      if (attempts === 1) {
        console.log(`🔍 qBittorrent has ${torrents.length} torrent(s):`);
        torrents.forEach((t) => {
          console.log(`   - "${t.name}" [${t.state}]`);
        });
        console.log(`🔍 Looking for torrent matching: "${torrentName}"`);
      }

      // Find the torrent by name (partial match in both directions, case-insensitive)
      const torrent = torrents.find((t) => {
        if (!torrentName) return false;
        const a = t.name.toLowerCase();
        const b = torrentName.toLowerCase();
        return a.includes(b) || b.includes(a);
      });

      if (!torrent) {
        console.log(`⏳ Waiting for torrent to appear in qBittorrent...`);
        return;
      }

      const progressPct = (torrent.progress * 100).toFixed(1);
      console.log(`📊 ${torrent.name}: ${progressPct}% [${torrent.state}]`);

      // Send progress update
      if (onProgress) {
        onProgress({
          name: torrent.name,
          progress: progressPct,
          state: torrent.state,
        });
      }

      // Check if complete
      if (torrent.progress >= 1.0 && (torrent.state === 'uploading' || torrent.state === 'pausedUP' || torrent.state === 'stalledUP')) {
        clearInterval(interval);
        console.log(`✅ Download complete: ${torrent.name}`);
        callback(true, torrent.name);
        return;
      }

      // Check if stalled (no seeds, no progress after a while)
      if ((torrent.state === 'stalledDL' && attempts > 20) || (torrent.num_seeds === 0 && attempts > 20)) {
        clearInterval(interval);
        console.log(`⚠️ Download stalled: ${torrent.name}`);
        callback(false, torrent.name);
        return;
      }

      // Timeout after max attempts
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.log(`⏱️ Download timeout: ${torrent.name}`);
        callback(false, torrent.name);
      }
    } catch (error) {
      console.error('Error polling qBittorrent:', error.message);
    }
  }, POLL_INTERVAL_MS);
}