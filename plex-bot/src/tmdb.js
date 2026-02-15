/**
 * TMDB API client for checking media availability
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Get API key (lazy load from env)
 */
function getApiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error('TMDB_API_KEY is not set in .env file');
  }
  return key;
}

/**
 * Check if a movie or TV show is available digitally (not cinema-only)
 */
export async function checkAvailability(parsed) {
  try {
    if (parsed.type === 'movie') {
      return await checkMovieAvailability(parsed.title, parsed.year);
    } else {
      return await checkTVAvailability(parsed.title);
    }
  } catch (error) {
    console.error('❌ TMDB API error:', error.message);
    console.error('Stack:', error.stack);
    return { found: false, error: error.message };
  }
}

async function checkMovieAvailability(title, year) {
  const TMDB_API_KEY = getApiKey();
  
  // Search for the movie
  const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  console.log('🔍 TMDB Search URL:', searchUrl.replace(TMDB_API_KEY, 'KEY_HIDDEN'));
  
  const searchRes = await fetch(searchUrl);
  console.log('📡 TMDB Response status:', searchRes.status);
  
  if (!searchRes.ok) {
    const errorText = await searchRes.text();
    console.error('❌ TMDB API error response:', errorText);
    throw new Error(`TMDB API returned ${searchRes.status}: ${errorText}`);
  }
  
  const searchData = await searchRes.json();
  console.log('📦 TMDB Search results:', searchData.results?.length || 0, 'results');

  if (!searchData.results || searchData.results.length === 0) {
    return { found: false };
  }

  const movie = searchData.results[0];
  console.log('🎬 Found movie:', movie.title, '(' + movie.release_date?.substring(0, 4) + ')');

  // Get release dates to check digital availability
  const releasesUrl = `${TMDB_BASE_URL}/movie/${movie.id}/release_dates?api_key=${TMDB_API_KEY}`;
  const releasesRes = await fetch(releasesUrl);
  
  if (!releasesRes.ok) {
    console.warn('⚠️ Could not fetch release dates, assuming available');
    // Fall back to theatrical release date check only
    const theatricalRelease = new Date(movie.release_date);
    const daysSinceRelease = (Date.now() - theatricalRelease) / (1000 * 60 * 60 * 24);
    const available = daysSinceRelease > 90;
    
    return {
      found: true,
      title: movie.title,
      year: new Date(movie.release_date).getFullYear(),
      available,
    };
  }
  
  const releasesData = await releasesRes.json();

  // Check if there's a digital or physical release
  const hasDigitalRelease = releasesData.results?.some((country) =>
    country.release_dates?.some((rd) => rd.type >= 4) // Type 4 = Digital, 5 = Physical, 6 = TV
  );

  // Also check if theatrical release was more than 90 days ago (usually means digital is out)
  const theatricalRelease = new Date(movie.release_date);
  const daysSinceRelease = (Date.now() - theatricalRelease) / (1000 * 60 * 60 * 24);

  const available = hasDigitalRelease || daysSinceRelease > 90;
  console.log('✅ Availability check:', available ? 'AVAILABLE' : 'CINEMA ONLY');

  return {
    found: true,
    title: movie.title,
    year: new Date(movie.release_date).getFullYear(),
    available,
  };
}

async function checkTVAvailability(title) {
  const TMDB_API_KEY = getApiKey();
  
  // Search for the TV show
  const searchUrl = `${TMDB_BASE_URL}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}`;
  console.log('🔍 TMDB Search URL:', searchUrl.replace(TMDB_API_KEY, 'KEY_HIDDEN'));
  
  const searchRes = await fetch(searchUrl);
  console.log('📡 TMDB Response status:', searchRes.status);
  
  if (!searchRes.ok) {
    const errorText = await searchRes.text();
    console.error('❌ TMDB API error response:', errorText);
    throw new Error(`TMDB API returned ${searchRes.status}: ${errorText}`);
  }
  
  const searchData = await searchRes.json();
  console.log('📦 TMDB Search results:', searchData.results?.length || 0, 'results');

  if (!searchData.results || searchData.results.length === 0) {
    return { found: false };
  }

  const show = searchData.results[0];
  console.log('📺 Found show:', show.name, '(' + show.first_air_date?.substring(0, 4) + ')');

  // TV shows are generally available if they've aired
  // Check if first air date has passed
  const firstAirDate = new Date(show.first_air_date);
  const available = firstAirDate < Date.now();

  return {
    found: true,
    title: show.name,
    year: new Date(show.first_air_date).getFullYear(),
    available,
  };
}
