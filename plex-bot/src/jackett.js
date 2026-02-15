/**
 * Jackett API client for torrent searching
 */

/**
 * Search Jackett for torrents matching the query
 */
export async function searchTorrents(query, type) {
  try {
    // Read config lazily (after dotenv has loaded)
    const JACKETT_URL = process.env.JACKETT_URL;
    const JACKETT_API_KEY = process.env.JACKETT_API_KEY;

    // Jackett Torznab API endpoint
    const searchUrl = `${JACKETT_URL}/api/v2.0/indexers/all/results?apikey=${JACKETT_API_KEY}&Query=${encodeURIComponent(query)}`;
    
    console.log(`🔍 Jackett search URL: ${searchUrl.replace(JACKETT_API_KEY, 'KEY_HIDDEN')}`);
    
    const res = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json' // Request JSON instead of XML
      }
    });
    
    if (!res.ok) {
      console.error(`❌ Jackett API error: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`   Response: ${errorText.substring(0, 200)}`);
      return [];
    }

    const data = await res.json();
    console.log(`📡 Jackett response: ${data.Results?.length || 0} results`);

    // Parse Jackett JSON format
    const torrents = parseJackettJSON(data);

    console.log(`📦 Found ${torrents.length} torrents from Jackett`);

    return torrents;
  } catch (error) {
    console.error('❌ Jackett search error:', error.message);
    console.error('   Stack:', error.stack);
    return [];
  }
}

/**
 * Parse Jackett's JSON response into structured data
 */
function parseJackettJSON(data) {
  if (!data.Results || !Array.isArray(data.Results)) {
    console.error('❌ Unexpected Jackett response format');
    return [];
  }

  return data.Results.map(result => ({
    title: result.Title || 'Unknown',
    magnetLink: result.MagnetUri || result.Link || null,
    size: formatBytes(result.Size || 0),
    seeders: result.Seeders || 0,
    peers: result.Peers || 0,
    publishDate: result.PublishDate || null,
    indexer: result.Tracker || 'Unknown'
  })).filter(t => t.magnetLink); // Only keep results with magnet links
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
