import https from 'https';
import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';

// In-memory cache with 30-minute expiry
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Usage tracking for current session
const usageStats = {
  tavilySearches: 0,
  braveSearches: 0,
  fetchRequests: 0,
  cacheHits: 0,
  tavilyCredits: 0
};

export const toolDefinition = {
  name: 'web_research',
  description: 'Comprehensive web research tool with search (Tavily/Brave), URL fetching, and combined research actions. Includes caching and usage tracking.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'fetch', 'research', 'usage'],
        description: 'Action to perform: search (web search), fetch (get specific URL), research (search + fetch top results), usage (show API stats)'
      },
      query: {
        type: 'string',
        description: 'Search query (required for search and research actions)'
      },
      url: {
        type: 'string',
        description: 'URL to fetch (required for fetch action)'
      },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Search depth for Tavily: basic (faster) or advanced (more comprehensive). Default: basic'
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of search results to return (1-10). Default: 5'
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance'],
        description: 'Search topic category. Default: general'
      },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Time range filter for results (optional)'
      },
      include_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of domains to include in search (optional)'
      },
      exclude_domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of domains to exclude from search (optional)'
      },
      country: {
        type: 'string',
        description: 'Country code for localized search (e.g., au, us, uk). Default: australia'
      }
    },
    required: ['action']
  }
};

export async function execute(input) {
  const { action } = input;

  switch (action) {
    case 'search':
      return await handleSearch(input);
    case 'fetch':
      return await handleFetch(input);
    case 'research':
      return await handleResearch(input);
    case 'usage':
      return handleUsage();
    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

// Search handler with Tavily primary and Brave fallback
async function handleSearch(input) {
  const { query, search_depth = 'basic', max_results = 5, topic = 'general',
          time_range, include_domains, exclude_domains, country = 'australia' } = input;

  if (!query) {
    return { success: false, error: 'Query is required for search action' };
  }

  // Check cache
  const cacheKey = getCacheKey('search', query, { search_depth, max_results, topic, time_range, include_domains, exclude_domains, country });
  const cached = getFromCache(cacheKey);
  if (cached) {
    usageStats.cacheHits++;
    return { success: true, ...cached, cached: true };
  }

  // Try Tavily first
  const tavilyResult = await searchWithTavily({
    query, search_depth, max_results, topic, time_range,
    include_domains, exclude_domains, country
  });

  if (tavilyResult.success) {
    setCache(cacheKey, tavilyResult);
    return tavilyResult;
  }

  // Fallback to Brave
  const braveResult = await searchWithBrave(query, max_results);
  if (braveResult.success) {
    setCache(cacheKey, braveResult);
    return braveResult;
  }

  return { success: false, error: 'Both Tavily and Brave search failed', tavilyError: tavilyResult.error, braveError: braveResult.error };
}

// Tavily search implementation
async function searchWithTavily(params) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'TAVILY_API_KEY environment variable not set' };
  }

  const requestBody = {
    query: params.query,
    search_depth: params.search_depth,
    max_results: params.max_results,
    topic: params.topic,
    include_answer: 'basic',
    include_raw_content: true,
    include_usage: true,
    country: params.country
  };

  if (params.time_range) requestBody.time_range = params.time_range;
  if (params.include_domains) requestBody.include_domains = params.include_domains;
  if (params.exclude_domains) requestBody.exclude_domains = params.exclude_domains;

  try {
    const response = await httpsRequest('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = JSON.parse(response);

    // Check for Tavily error responses
    if (data.error || data.status === 'error') {
      return { success: false, error: data.error || data.message || 'Tavily returned an error' };
    }

    usageStats.tavilySearches++;
    if (data.usage) {
      usageStats.tavilyCredits += (data.usage.credits || 0);
    }

    return {
      success: true,
      source: 'tavily',
      query: data.query,
      answer: data.answer,
      results: data.results || [],
      images: data.images || [],
      response_time: data.response_time,
      usage: data.usage
    };
  } catch (error) {
    return { success: false, error: `Tavily API error: ${error.message}` };
  }
}

// Brave search implementation
async function searchWithBrave(query, max_results = 5) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'BRAVE_API_KEY environment variable not set' };
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${max_results}`;

  try {
    const response = await httpsRequest(url, {
      method: 'GET',
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json'
      }
    });

    const data = JSON.parse(response);
    usageStats.braveSearches++;

    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      content: r.description,
      score: r.page_age ? 1 / (r.page_age + 1) : 0.5 // Approximate relevance
    }));

    return {
      success: true,
      source: 'brave',
      query: query,
      answer: null,
      results: results,
      images: [],
      response_time: null,
      usage: null
    };
  } catch (error) {
    return { success: false, error: `Brave API error: ${error.message}` };
  }
}

// Fetch URL handler
async function handleFetch(input) {
  const { url } = input;

  if (!url) {
    return { success: false, error: 'URL is required for fetch action' };
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  // Check cache
  const cacheKey = getCacheKey('fetch', url);
  const cached = getFromCache(cacheKey);
  if (cached) {
    usageStats.cacheHits++;
    return { success: true, ...cached, cached: true };
  }

  try {
    const content = await fetchUrl(url);
    usageStats.fetchRequests++;

    const result = {
      url: url,
      content: content,
      length: content.length
    };

    setCache(cacheKey, result);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: `Failed to fetch URL: ${error.message}` };
  }
}

// Research handler - combines search + fetch
async function handleResearch(input) {
  const { query, max_results = 5 } = input;

  if (!query) {
    return { success: false, error: 'Query is required for research action' };
  }

  // Check cache
  const cacheKey = getCacheKey('research', query, { max_results });
  const cached = getFromCache(cacheKey);
  if (cached) {
    usageStats.cacheHits++;
    return { success: true, ...cached, cached: true };
  }

  // Perform search with raw content
  const searchParams = { ...input, search_depth: 'advanced' };
  const searchResult = await handleSearch(searchParams);

  if (!searchResult.success) {
    return searchResult;
  }

  // Check if we got raw_content from Tavily
  const resultsWithContent = [];
  const resultsNeedingFetch = [];

  for (const result of searchResult.results || []) {
    if (result.raw_content) {
      resultsWithContent.push({
        ...result,
        content: result.raw_content.substring(0, 8000)
      });
    } else if (result.content) {
      resultsWithContent.push(result);
    } else {
      resultsNeedingFetch.push(result);
    }
  }

  // Fetch top URLs that don't have content (limit to top 2 to avoid rate limits)
  const fetchPromises = resultsNeedingFetch.slice(0, 2).map(async (result) => {
    try {
      const content = await fetchUrl(result.url);
      usageStats.fetchRequests++;
      return {
        ...result,
        content: content,
        fetched: true
      };
    } catch (error) {
      return {
        ...result,
        content: `[Failed to fetch: ${error.message}]`,
        fetched: false
      };
    }
  });

  const fetchedResults = await Promise.all(fetchPromises);
  const allResults = [...resultsWithContent, ...fetchedResults];

  const researchResult = {
    query: searchResult.query,
    answer: searchResult.answer,
    source: searchResult.source,
    results: allResults,
    total_results: allResults.length,
    response_time: searchResult.response_time,
    usage: searchResult.usage
  };

  setCache(cacheKey, researchResult);
  return { success: true, ...researchResult };
}

// Usage stats handler
function handleUsage() {
  return {
    success: true,
    stats: {
      ...usageStats,
      cacheSize: cache.size,
      estimatedTavilyCredits: usageStats.tavilyCredits
    }
  };
}

// Fetch URL with redirect following and HTML parsing
async function fetchUrl(url, maxRedirects = 5, redirectCount = 0) {
  if (redirectCount >= maxRedirects) {
    throw new Error('Too many redirects');
  }

  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout after 10 seconds'));
    }, 10000);

    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = client.request(url, options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        const redirectUrl = new URL(res.headers.location, url).href;
        fetchUrl(redirectUrl, maxRedirects, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => {
        data += chunk;
        // Prevent memory issues with huge responses
        if (data.length > 1000000) {
          req.destroy();
          clearTimeout(timeout);
          reject(new Error('Response too large'));
        }
      });

      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const cleaned = cleanHtml(data);
          resolve(cleaned);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    req.end();
  });
}

// Clean HTML to readable text/markdown
function cleanHtml(html) {
  let text = html;

  // Remove scripts, styles, nav, header, footer
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  text = text.replace(/<(nav|header|footer)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, '');

  // Convert common block elements to newlines
  text = text.replace(/<\/(div|p|br|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');
  text = text.trim();

  // Truncate if too long (keep first ~8000 chars)
  if (text.length > 8000) {
    text = text.substring(0, 8000) + '\n\n[Content truncated - original length: ' + text.length + ' characters]';
  }

  return text;
}

// HTTPS/HTTP request wrapper
function httpsRequest(url, options = {}) {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// Cache utilities
function getCacheKey(action, identifier, params = {}) {
  const hash = crypto.createHash('md5')
    .update(action + identifier + JSON.stringify(params))
    .digest('hex');
  return hash;
}

function getFromCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}
