/**
 * Filter and rank torrents by quality preferences
 * 
 * Preferences:
 * - Prefer 720p over 1080p (smaller, faster)
 * - Prefer WEBRip, BluRay, WEB-DL
 * - Blacklist CAM, TS, HDTS, Telesync, Screener
 * - Trust YIFY/YTS releases
 * - Sort by seeders
 */

const QUALITY_PREFERENCE = [
  // 720p gets HIGHEST priority (100-95 range)
  { regex: /bluray.*720p/i, score: 100 },
  { regex: /web-?dl.*720p/i, score: 95 },
  { regex: /webrip.*720p/i, score: 90 },
  { regex: /720p/i, score: 85 }, // Generic 720p
  
  // 1080p gets LOWER priority (70-50 range)
  { regex: /bluray.*1080p/i, score: 70 },
  { regex: /web-?dl.*1080p/i, score: 65 },
  { regex: /webrip.*1080p/i, score: 60 },
  { regex: /1080p/i, score: 50 }, // Generic 1080p
  
  // 2160p even lower
  { regex: /2160p/i, score: 40 },
];

const BLACKLIST = [
  /\bCAM\b/i,
  /\bHDCAM\b/i,
  /\bTS\b/i,
  /\bHDTS\b/i,
  /\bTelesync\b/i,
  /\bTELECINE\b/i,
  /\bSCR\b/i,
  /\bScreener\b/i,
  /\bR5\b/i,
];

const TRUSTED_GROUPS = [
  /YIFY/i,
  /YTS/i,
];

export function filterTorrents(torrents) {
  // Remove blacklisted torrents
  const filtered = torrents.filter((t) => {
    const isBlacklisted = BLACKLIST.some((regex) => regex.test(t.title));
    return !isBlacklisted;
  });

  if (filtered.length === 0) return [];

  // Score each torrent
  const scored = filtered.map((t) => {
    let score = 0;

    // Quality score (only use the FIRST match to avoid double-scoring)
    for (const pref of QUALITY_PREFERENCE) {
      if (pref.regex.test(t.title)) {
        score += pref.score;
        break; // Stop after first match
      }
    }

    // Trusted group bonus
    if (TRUSTED_GROUPS.some((regex) => regex.test(t.title))) {
      score += 20;
    }

    // Seeders bonus (logarithmic scale, capped at +30)
    score += Math.min(Math.log10(t.seeders + 1) * 10, 30);

    // Extract quality string for display
    const qualityMatch = t.title.match(/(WEBRip|BluRay|WEB-DL|HDTV).*?(720p|1080p|2160p)/i);
    const quality = qualityMatch ? `${qualityMatch[1]} ${qualityMatch[2]}` : null;

    return { ...t, score, quality };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  console.log(`\n🎯 Top 5 torrents after scoring:`);
  scored.slice(0, 5).forEach((t, i) => {
    console.log(`   ${i + 1}. [Score: ${t.score.toFixed(1)}] ${t.title.substring(0, 60)}...`);
    console.log(`      ${t.size}, ${t.seeders} seeders`);
  });

  return scored;
}
