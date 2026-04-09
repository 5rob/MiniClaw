# browser-control

Full browser automation via Puppeteer / Chrome DevTools Protocol (CDP). Runs in an isolated Chromium instance (not your personal browser profile).

## What It Does

- Navigate to any URL and wait for the page to fully load
- Generate a numbered element snapshot so you can say "click [3]" instead of writing CSS selectors
- Click, type, fill forms, hover, scroll, select dropdowns
- Take screenshots (WebP) and export PDFs
- Read/set cookies, run custom JavaScript, spoof geolocation and HTTP headers
- Session state persists between calls (browser stays open until you close it)

## Recommended Workflow

1. `navigate` → go to a URL
2. `snapshot` → get numbered list of interactive elements
3. `click [N]` / `type [N]` → interact by reference number
4. `screenshot` → verify what you see
5. `close` → shut down when done

## Actions

| Action | What it does |
|---|---|
| `navigate` | Go to a URL |
| `snapshot` | Get numbered list of clickable elements (mode: ai or role) |
| `click` | Click element by ref number or CSS selector |
| `type` | Type text into an input |
| `fill_form` | Fill multiple fields at once |
| `select` | Choose an option from a `<select>` dropdown |
| `clear` | Clear an input field |
| `screenshot` | Capture page screenshot (WebP) |
| `pdf` | Export page as PDF |
| `scroll` | Scroll in a direction |
| `hover` | Hover over an element |
| `back` / `forward` / `reload` | Browser navigation |
| `get_text` | Extract text from page or element |
| `get_url` | Get current URL and page title |
| `get_cookies` | Read current cookies |
| `set_cookies` | Set cookies |
| `set_headers` | Add HTTP headers to all requests |
| `set_geolocation` | Spoof GPS location |
| `execute` | Run JavaScript in the page context |
| `wait` | Wait for selector / URL / load state / JS condition |
| `status` | Check if browser is running |
| `close` | Close the browser |

## Example Trigger Phrases

- "open google.com and search for Houdini tutorials"
- "fill out this contact form on example.com"
- "take a screenshot of the homepage"
- "click the login button and enter my credentials"
- "scrape the product prices from this shopping site"
- "automate my weekly report submission"
- "interact with the admin panel"
- "test if the checkout flow works"
- "go to this URL and tell me what's on the page"

## Setup

Requires Puppeteer. If not installed:

```
npm install puppeteer
```

Run from the MiniClaw staging directory. Chromium (~170MB) will be downloaded automatically on first install.

## Storage

| Path | Contents |
|---|---|
| `data/profile/` | Persistent Chromium user profile (cookies, localStorage) |
| `data/screenshots/` | Saved screenshots (.webp) |
| `data/pdfs/` | Exported PDFs |
| `data/session.json` | Last visited URL |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BROWSER_HEADLESS` | `true` | Set to `false` to see the browser window |
