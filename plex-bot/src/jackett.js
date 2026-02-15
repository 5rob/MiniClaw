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
    
    const res = await fetch(searchUrl);
    
    if (!res.ok) {
      console.error(`❌ Jackett API error: ${res.status} ${res.statusText}`);
      const errorText = await res.text();
      console.error(`   Response: ${errorText.substring(0, 200)}`);
      return [];
    }

    const text = await res.text();
    console.log(`📡 Jackett response length: ${text.length} bytes`);

    // Jackett returns XML (Torznab format), parse it manually
    const torrents = parseJackettXML(text);

    console.log(`📦 Found ${torrents.length} torrents from Jackett`);

    return torrents;
  } catch (error) {
    console.error('❌ Jackett search error:', error.message);
    console.error('   Stack:', error.stack);
    return [];
  }
}

/**
 * Parse Jackett's XML response into structured data
 */
function parseJackettXML(xml) {
  const torrents = [];
  
  // Extract each <item> block
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link'); // This is the torrent details page
    const size = extractTag(itemXml, 'size');
    const seeders = extractAttribute(itemXml, 'torznab:attr', 'name="seeders"', 'value');
    const magnetLink = extractTag(itemXml, 'magneturl') || extractTag(itemXml, 'link');

    if (title && magnetLink) {
      torrents.push({
        title,
        magnetLink,
        size: formatBytes(parseInt(size) || 0),
        seeders: parseInt(seeders) || 0,
      });
    }
  }

  return torrents;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i');
  const match = xml.match(regex);
  if (match) return match[1].trim();

  const simpleRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const simpleMatch = xml.match(simpleRegex);
  return simpleMatch ? simpleMatch[1].trim() : null;
}

function extractAttribute(xml, tag, attrCondition, attrName) {
  const regex = new RegExp(`<${tag}[^>]*${attrCondition}[^>]*${attrName}="([^"]*)"`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
