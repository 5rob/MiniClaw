/**
 * Parse Nicole's media requests into structured data
 * 
 * Supported formats:
 * - Movie: "Blue Moon (2025)"
 * - TV Episode: "Breaking Bad S03E08" or "Breaking Bad S3E8"
 * - TV Season: "Seinfeld season 4" or "Seinfeld S04"
 */

export function parseRequest(message) {
  const trimmed = message.trim();

  // Movie format: "Title (Year)"
  const movieMatch = trimmed.match(/^(.+?)\s*\((\d{4})\)$/);
  if (movieMatch) {
    return {
      type: 'movie',
      title: movieMatch[1].trim(),
      year: parseInt(movieMatch[2], 10),
    };
  }

  // TV Episode format: "Show S01E05" or "Show S1E5"
  const episodeMatch = trimmed.match(/^(.+?)\s+S(\d{1,2})E(\d{1,2})$/i);
  if (episodeMatch) {
    return {
      type: 'tv',
      title: episodeMatch[1].trim(),
      season: parseInt(episodeMatch[2], 10),
      episode: parseInt(episodeMatch[3], 10),
    };
  }

  // TV Season format: "Show season 4" or "Show S04"
  const seasonMatch = trimmed.match(/^(.+?)\s+(?:season|S)\s*(\d{1,2})$/i);
  if (seasonMatch) {
    return {
      type: 'tv',
      title: seasonMatch[1].trim(),
      season: parseInt(seasonMatch[2], 10),
    };
  }

  // No match
  return null;
}
