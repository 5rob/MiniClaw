# web-research Skill

A comprehensive web research tool for MiniClaw that provides intelligent web searching, URL fetching, and combined research capabilities.

## What It Does

This skill gives Claude the ability to:

1. **Search the web** using Tavily AI (primary) with Brave Search as fallback
2. **Fetch and parse** specific URLs into clean, readable text
3. **Research topics** by combining search with automatic content fetching
4. **Track API usage** and cache results for efficiency

## Actions

### search
Search the web for information using Tavily AI with Brave Search as fallback.

**Parameters:**
- `query` (required) - The search query
- `search_depth` (optional) - 'basic' (default) or 'advanced' for comprehensive results
- `max_results` (optional) - Number of results (1-10, default: 5)
- `topic` (optional) - 'general' (default), 'news', or 'finance'
- `time_range` (optional) - 'day', 'week', 'month', or 'year'
- `include_domains` (optional) - Array of domains to include
- `exclude_domains` (optional) - Array of domains to exclude
- `country` (optional) - Country code for localization (default: 'australia')

**Returns:**
- LLM-generated answer to the query (from Tavily)
- Array of search results with title, URL, content, and relevance score
- Response time and API usage stats
- Source indicator (tavily or brave)

### fetch
Fetch and parse a specific URL into clean, readable text.

**Parameters:**
- `url` (required) - The URL to fetch

**Returns:**
- Cleaned text content from the page
- Content length
- Original URL

**Features:**
- Follows redirects (up to 5)
- Strips HTML tags, scripts, styles, navigation
- Converts to readable markdown-like format
- Truncates to ~8000 characters for large pages
- 10-second timeout protection

### research
High-level research combining search with automatic content fetching.

**Parameters:**
- `query` (required) - The research query
- `max_results` (optional) - Number of results (default: 5)
- All search parameters supported

**Returns:**
- LLM-generated answer
- Search results with full content (either from Tavily's raw_content or fetched)
- Automatically fetches content for top 2 URLs that don't have content
- Total result count
- Response time and usage stats

**Best For:**
- Deep research requiring full article content
- When you need comprehensive information on a topic
- Comparative analysis across multiple sources

### usage
Show API usage statistics for the current session.

**Returns:**
- Tavily searches count
- Brave searches count
- Fetch requests count
- Cache hits count
- Estimated Tavily credits used
- Current cache size

## When to Use This Tool

### Use `search` when:
- User asks to "search for", "look up", "find information about"
- Quick fact-checking or general queries
- Need recent news or finance information
- Want multiple perspectives on a topic

### Use `fetch` when:
- User provides a specific URL to read
- Need to extract content from a known page
- Want clean text from an article or documentation

### Use `research` when:
- User asks to "research", "investigate", or "analyze"
- Need comprehensive information with full content
- Comparing multiple sources
- Deep dive into a complex topic

### Use `usage` when:
- User asks about API consumption or costs
- Checking how many searches have been performed
- Monitoring cache efficiency

## Example Trigger Phrases

- "search for Hume AI TTS"
- "look up Godot 4.3 new features"
- "what's the latest news on AI regulation?"
- "fetch https://hume.ai"
- "research Node.js worker threads"
- "investigate the pros and cons of Rust vs Go"
- "how many searches have I used today?"
- "show me usage stats"

## Features

### Intelligent Caching
- 30-minute in-memory cache for all actions
- Reduces API costs and improves response time
- Automatic cache key generation based on action and parameters

### Robust Error Handling
- Automatic fallback from Tavily to Brave on failures
- Graceful handling of rate limits (429, 432, 433)
- Clear error messages for debugging
- Timeout protection for slow URLs

### Smart Content Processing
- HTML to clean text conversion
- Removes navigation, ads, scripts, styles
- Preserves readable content structure
- Truncates intelligently for long content

### Australian Localization
- Default country set to 'australia' for Tavily searches
- Configurable per-request with country parameter

## Configuration

Requires two environment variables:
- `TAVILY_API_KEY` - Your Tavily AI API key (primary search)
- `BRAVE_API_KEY` - Your Brave Search API key (fallback)

The skill will work with either key, but both are recommended for best reliability.

## Limitations

- Fetch action limited to ~8000 characters per page
- Research action fetches full content for max 2 additional URLs
- Cache is in-memory only (resets on bot restart)
- 10-second timeout for URL fetching
- Maximum 5 redirects when fetching URLs

## Technical Details

- Pure Node.js implementation (no npm dependencies)
- Uses native https/http modules
- ES modules (import/export)
- Windows-compatible file paths
- Session-based usage tracking
- MD5-based cache key hashing
