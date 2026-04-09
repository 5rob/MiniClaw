/**
 * browser-control — Puppeteer-based browser automation skill for MiniClaw
 * Uses Chrome DevTools Protocol (CDP) via Puppeteer for full browser control.
 * CAPTCHA solving via Gemini Vision (v1.1)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { detectCaptchaType, solvePuzzleCaptcha, solveRecaptchaV2 } from './captcha-solver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
const SCREENSHOTS_DIR = path.resolve(DATA_DIR, 'screenshots');
const PDFS_DIR = path.resolve(DATA_DIR, 'pdfs');
const SESSION_FILE = path.resolve(DATA_DIR, 'session.json');
const PROFILE_DIR = path.resolve(DATA_DIR, 'profile');

// Ensure data dirs exist
for (const dir of [DATA_DIR, SCREENSHOTS_DIR, PDFS_DIR, PROFILE_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Singleton browser/page state ────────────────────────────────────────────
let _browser = null;
let _page = null;
// Map from numeric ref → { selector, xpath, index }
let _elementRefs = new Map();
let _refCounter = 0;

function saveSession(url) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ url, ts: Date.now() }, null, 2));
  } catch {}
}

async function getPuppeteer() {
  try {
    const mod = await import('puppeteer');
    return mod.default ?? mod;
  } catch {
    throw new Error(
      'Puppeteer is not installed. Run: npm install puppeteer  (in the MiniClaw staging directory)'
    );
  }
}

async function ensureBrowser(headless) {
  if (_browser && _browser.connected) return _browser;
  const puppeteer = await getPuppeteer();
  const isHeadless = headless ?? (process.env.BROWSER_HEADLESS !== 'false');
  _browser = await puppeteer.launch({
    headless: isHeadless,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
    ],
    defaultViewport: { width: 1280, height: 900 },
  });
  _browser.on('disconnected', () => {
    _browser = null;
    _page = null;
    _elementRefs.clear();
  });
  return _browser;
}

async function ensurePage(headless) {
  const browser = await ensureBrowser(headless);
  if (_page && !_page.isClosed()) return _page;
  const pages = await browser.pages();
  _page = pages.length > 0 ? pages[0] : await browser.newPage();
  // Stealth: hide webdriver flag
  await _page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return _page;
}

// ── Element Snapshot ─────────────────────────────────────────────────────────

const SNAPSHOT_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea',
  '[role="button"]', '[role="link"]', '[role="checkbox"]',
  '[role="radio"]', '[role="menuitem"]', '[role="tab"]',
  '[role="combobox"]', '[onclick]', 'label[for]',
  'summary', 'details',
].join(', ');

async function generateSnapshot(page, mode = 'ai') {
  _elementRefs.clear();
  _refCounter = 0;

  const elements = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const results = [];

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    }

    function getLabel(el) {
      if (el.labels && el.labels.length > 0) return el.labels[0].textContent.trim();
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
      if (el.getAttribute('title')) return el.getAttribute('title');
      if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
      const text = el.textContent?.trim();
      if (text) return text.slice(0, 80);
      return '';
    }

    let ref = 1;
    for (const el of els) {
      if (!isVisible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type') || '';
      const role = el.getAttribute('role') || '';
      const label = getLabel(el);
      const href = el.getAttribute('href') || '';
      const name = el.getAttribute('name') || '';
      const id = el.getAttribute('id') || '';

      // Build a unique-ish CSS path for later retrieval
      let cssPath = tag;
      if (id) cssPath = `#${id}`;
      else if (el.className) {
        const classes = Array.from(el.classList).slice(0, 2).join('.');
        if (classes) cssPath = `${tag}.${classes}`;
      }

      el.setAttribute('data-mref', String(ref));

      results.push({
        ref,
        tag,
        type,
        role,
        label,
        href: href.slice(0, 100),
        name,
        id,
      });
      ref++;
    }
    return results;
  }, SNAPSHOT_SELECTOR);

  // Build ref map (index-based for click resolution)
  elements.forEach((el, i) => {
    _elementRefs.set(el.ref, { index: i, tag: el.tag, type: el.type });
  });
  _refCounter = elements.length;

  if (mode === 'role') {
    // Role-based accessibility snapshot
    const lines = elements.map(el => {
      const role = el.role || el.tag;
      const label = el.label || '(unlabeled)';
      const extra = el.href ? ` → ${el.href}` : el.type ? ` [${el.type}]` : '';
      return `[${el.ref}] ${role.padEnd(12)} "${label}"${extra}`;
    });
    return { mode: 'role', count: elements.length, snapshot: lines.join('\n') };
  }

  // AI mode — concise numbered list
  const lines = elements.map(el => {
    const typeStr = el.type ? ` type="${el.type}"` : '';
    const extra = el.href ? ` href="${el.href}"` : '';
    return `[${el.ref}] ${el.label || '(no label)'} <${el.tag}${typeStr}${extra}>`;
  });
  return { mode: 'ai', count: elements.length, snapshot: lines.join('\n') };
}

// ── Click helper ─────────────────────────────────────────────────────────────

async function resolveAndClick(page, ref, selector) {
  if (ref != null) {
    // Click via data-mref attribute injected during snapshot
    const el = await page.$(`[data-mref="${ref}"]`);
    if (!el) return { success: false, error: `Element [${ref}] not found. Run snapshot first.` };
    await el.click();
    return { success: true, clicked: ref };
  }
  if (selector) {
    await page.click(selector);
    return { success: true, clicked: selector };
  }
  return { success: false, error: 'Provide ref or selector' };
}

// ── Tool Definition ───────────────────────────────────────────────────────────

export const toolDefinition = {
  name: 'browser_control',
  description:
    'Full browser automation via Puppeteer/CDP. Navigate websites, interact with elements, fill forms, take screenshots, manage cookies, run JavaScript, and SOLVE CAPTCHAs using AI vision. Use snapshot first to get numbered element references, then click/type by number. Can automatically detect and solve puzzle sliders and reCAPTCHA v2 challenges.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'navigate', 'snapshot', 'click', 'type', 'fill_form',
          'screenshot', 'pdf', 'get_cookies', 'set_cookies',
          'execute', 'wait', 'close', 'status', 'scroll',
          'hover', 'select', 'clear', 'back', 'forward', 'reload',
          'get_text', 'get_url', 'set_headers', 'set_geolocation',
          'solve_captcha', 'solve_puzzle', 'solve_recaptcha', 'detect_captcha',
        ],
        description: 'Browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (navigate action)',
      },
      ref: {
        type: 'number',
        description: 'Element reference number from snapshot (click, type, hover, select)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector as fallback when ref is not available (also used for puzzle slider selector)',
      },
      text: {
        type: 'string',
        description: 'Text to type (type action) or JavaScript to execute (execute action)',
      },
      fields: {
        type: 'array',
        description: 'Array of {ref?, selector?, value} for fill_form',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'number' },
            selector: { type: 'string' },
            value: { type: 'string' },
          },
        },
      },
      mode: {
        type: 'string',
        enum: ['ai', 'role'],
        description: 'Snapshot mode: ai (default, numbered list) or role (accessibility tree)',
      },
      wait_until: {
        type: 'string',
        enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'],
        description: 'Load state to wait for during navigate (default: networkidle2)',
      },
      wait_for: {
        type: 'string',
        description: 'wait action: css selector, URL substring, or JS expression (prefixed js:)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default 30000)',
      },
      headless: {
        type: 'boolean',
        description: 'Run headless (default true). Set false to watch the browser.',
      },
      filename: {
        type: 'string',
        description: 'Output filename for screenshot or pdf (without extension)',
      },
      full_page: {
        type: 'boolean',
        description: 'Capture full page for screenshot (default false)',
      },
      scroll_direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right', 'top', 'bottom'],
        description: 'Direction to scroll',
      },
      scroll_amount: {
        type: 'number',
        description: 'Pixels to scroll (default 500)',
      },
      cookies: {
        type: 'array',
        description: 'Cookies to set [{name, value, domain?, path?, ...}]',
        items: { type: 'object' },
      },
      option_value: {
        type: 'string',
        description: 'Value to select in <select> dropdown',
      },
      headers: {
        type: 'object',
        description: 'HTTP headers to set for all requests',
      },
      geolocation: {
        type: 'object',
        description: '{ latitude, longitude, accuracy? } for geolocation spoofing',
      },
      clear_before_type: {
        type: 'boolean',
        description: 'Clear field before typing (default true)',
      },
      max_attempts: {
        type: 'number',
        description: 'Maximum CAPTCHA solving attempts (default 3)',
      },
      captcha_target: {
        type: 'string',
        description: 'Target object for reCAPTCHA (e.g. "traffic lights", "buses"). Auto-detected if not provided.',
      },
    },
    required: ['action'],
  },
};

// ── Execute ──────────────────────────────────────────────────────────────────

export async function execute(input) {
  const {
    action,
    url,
    ref,
    selector,
    text,
    fields,
    mode = 'ai',
    wait_until = 'networkidle2',
    wait_for,
    timeout = 30000,
    headless,
    filename,
    full_page = false,
    scroll_direction = 'down',
    scroll_amount = 500,
    cookies,
    option_value,
    headers,
    geolocation,
    clear_before_type = true,
    max_attempts = 3,
    captcha_target,
  } = input;

  try {
    switch (action) {

      // ── CAPTCHA SOLVING ─────────────────────────────────────────────────

      case 'detect_captcha': {
        const page = await ensurePage(headless);
        const type = await detectCaptchaType(page);
        return { success: true, type, url: page.url() };
      }

      case 'solve_captcha': {
        const page = await ensurePage(headless);
        const type = await detectCaptchaType(page);
        
        if (type === 'unknown') {
          return { success: false, error: 'No CAPTCHA detected on page' };
        }

        console.log(`[browser-control] Detected CAPTCHA type: ${type}`);

        if (type === 'puzzle') {
          return await solvePuzzleCaptcha(page, selector, max_attempts);
        }

        if (type === 'recaptcha_v2') {
          return await solveRecaptchaV2(page, captcha_target);
        }

        if (type === 'text') {
          return { success: false, error: 'Text CAPTCHA solving not yet implemented' };
        }

        return { success: false, error: `Unknown CAPTCHA type: ${type}` };
      }

      case 'solve_puzzle': {
        const page = await ensurePage(headless);
        return await solvePuzzleCaptcha(page, selector, max_attempts);
      }

      case 'solve_recaptcha': {
        const page = await ensurePage(headless);
        return await solveRecaptchaV2(page, captcha_target);
      }

      // ── status ──────────────────────────────────────────────────────────
      case 'status': {
        const running = !!(_browser && _browser.connected && _page && !_page.isClosed());
        let currentUrl = null;
        if (running) {
          try { currentUrl = _page.url(); } catch {}
        }
        let session = null;
        if (fs.existsSync(SESSION_FILE)) {
          try { session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch {}
        }
        return { success: true, running, currentUrl, session, elementRefs: _refCounter };
      }

      // ── navigate ────────────────────────────────────────────────────────
      case 'navigate': {
        if (!url) return { success: false, error: 'url is required' };
        const page = await ensurePage(headless);
        await page.goto(url, { waitUntil: wait_until, timeout });
        const finalUrl = page.url();
        const title = await page.title();
        saveSession(finalUrl);
        return { success: true, url: finalUrl, title };
      }

      // ── snapshot ────────────────────────────────────────────────────────
      case 'snapshot': {
        const page = await ensurePage(headless);
        const result = await generateSnapshot(page, mode);
        const pageUrl = page.url();
        const title = await page.title();
        return { success: true, url: pageUrl, title, ...result };
      }

      // ── click ───────────────────────────────────────────────────────────
      case 'click': {
        if (ref == null && !selector) return { success: false, error: 'ref or selector required' };
        const page = await ensurePage(headless);
        const result = await resolveAndClick(page, ref, selector);
        if (result.success) {
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
          saveSession(page.url());
        }
        return result;
      }

      // ── type ────────────────────────────────────────────────────────────
      case 'type': {
        if (ref == null && !selector) return { success: false, error: 'ref or selector required' };
        if (!text) return { success: false, error: 'text is required' };
        const page = await ensurePage(headless);
        let el;
        if (ref != null) {
          el = await page.$(`[data-mref="${ref}"]`);
          if (!el) return { success: false, error: `Element [${ref}] not found. Run snapshot first.` };
        } else {
          el = await page.$(selector);
          if (!el) return { success: false, error: `Selector "${selector}" not found` };
        }
        if (clear_before_type) {
          await el.click({ clickCount: 3 });
          await el.press('Backspace');
        }
        await el.type(text, { delay: 20 });
        return { success: true, typed: text, into: ref ?? selector };
      }

      // ── clear ───────────────────────────────────────────────────────────
      case 'clear': {
        if (ref == null && !selector) return { success: false, error: 'ref or selector required' };
        const page = await ensurePage(headless);
        let el;
        if (ref != null) {
          el = await page.$(`[data-mref="${ref}"]`);
          if (!el) return { success: false, error: `Element [${ref}] not found` };
        } else {
          el = await page.$(selector);
          if (!el) return { success: false, error: `Selector "${selector}" not found` };
        }
        await el.click({ clickCount: 3 });
        await el.press('Backspace');
        return { success: true, cleared: ref ?? selector };
      }

      // ── fill_form ───────────────────────────────────────────────────────
      case 'fill_form': {
        if (!fields || !Array.isArray(fields)) return { success: false, error: 'fields array required' };
        const page = await ensurePage(headless);
        const results = [];
        for (const field of fields) {
          const { ref: fRef, selector: fSel, value } = field;
          if (value == null) { results.push({ field: fRef ?? fSel, error: 'no value' }); continue; }
          let el;
          if (fRef != null) {
            el = await page.$(`[data-mref="${fRef}"]`);
          } else if (fSel) {
            el = await page.$(fSel);
          }
          if (!el) { results.push({ field: fRef ?? fSel, error: 'not found' }); continue; }
          const tagName = await el.evaluate(e => e.tagName.toLowerCase());
          if (tagName === 'select') {
            await el.select(value);
          } else {
            await el.click({ clickCount: 3 });
            await el.press('Backspace');
            await el.type(value, { delay: 15 });
          }
          results.push({ field: fRef ?? fSel, value, success: true });
        }
        const allOk = results.every(r => r.success);
        return { success: allOk, results };
      }

      // ── select ──────────────────────────────────────────────────────────
      case 'select': {
        if (ref == null && !selector) return { success: false, error: 'ref or selector required' };
        if (!option_value) return { success: false, error: 'option_value required' };
        const page = await ensurePage(headless);
        let el;
        if (ref != null) {
          el = await page.$(`[data-mref="${ref}"]`);
          if (!el) return { success: false, error: `Element [${ref}] not found` };
        } else {
          el = await page.$(selector);
          if (!el) return { success: false, error: `Selector "${selector}" not found` };
        }
        await el.select(option_value);
        return { success: true, selected: option_value };
      }

      // ── screenshot ──────────────────────────────────────────────────────
      case 'screenshot': {
        const page = await ensurePage(headless);
        const ts = Date.now();
        const fname = filename ? `${filename}.webp` : `screenshot-${ts}.webp`;
        const filePath = path.resolve(SCREENSHOTS_DIR, fname);
        await page.screenshot({
          path: filePath,
          type: 'webp',
          quality: 80,
          fullPage: full_page,
        });
        const stat = fs.statSync(filePath);
        return {
          success: true,
          file: filePath,
          filename: fname,
          size: stat.size,
          url: page.url(),
        };
      }

      // ── pdf ─────────────────────────────────────────────────────────────
      case 'pdf': {
        const page = await ensurePage(headless);
        const ts = Date.now();
        const fname = filename ? `${filename}.pdf` : `page-${ts}.pdf`;
        const filePath = path.resolve(PDFS_DIR, fname);
        await page.pdf({
          path: filePath,
          format: 'Letter',
          printBackground: true,
          margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
        });
        const stat = fs.statSync(filePath);
        return { success: true, file: filePath, filename: fname, size: stat.size };
      }

      // ── get_cookies ─────────────────────────────────────────────────────
      case 'get_cookies': {
        const page = await ensurePage(headless);
        const c = await page.cookies();
        return { success: true, cookies: c, count: c.length };
      }

      // ── set_cookies ─────────────────────────────────────────────────────
      case 'set_cookies': {
        if (!cookies || !Array.isArray(cookies)) return { success: false, error: 'cookies array required' };
        const page = await ensurePage(headless);
        await page.setCookie(...cookies);
        return { success: true, set: cookies.length };
      }

      // ── execute (JavaScript) ────────────────────────────────────────────
      case 'execute': {
        if (!text) return { success: false, error: 'text (JavaScript code) is required' };
        const page = await ensurePage(headless);
        const result = await page.evaluate(new Function(`return (async () => { ${text} })()`));
        return { success: true, result };
      }

      // ── wait ────────────────────────────────────────────────────────────
      case 'wait': {
        if (!wait_for) return { success: false, error: 'wait_for is required' };
        const page = await ensurePage(headless);

        if (wait_for.startsWith('js:')) {
          const expr = wait_for.slice(3);
          await page.waitForFunction(expr, { timeout });
          return { success: true, waited: 'js condition' };
        }

        if (wait_for.startsWith('url:')) {
          const target = wait_for.slice(4);
          await page.waitForFunction(
            (t) => window.location.href.includes(t),
            { timeout },
            target
          );
          return { success: true, waited: 'url', url: page.url() };
        }

        if (['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(wait_for)) {
          await page.waitForNavigation({ waitUntil: wait_for, timeout });
          return { success: true, waited: wait_for };
        }

        // Default: treat as CSS selector
        await page.waitForSelector(wait_for, { timeout });
        return { success: true, waited: 'selector', selector: wait_for };
      }

      // ── scroll ──────────────────────────────────────────────────────────
      case 'scroll': {
        const page = await ensurePage(headless);
        const amount = scroll_amount;
        const dirMap = {
          down: `window.scrollBy(0, ${amount})`,
          up: `window.scrollBy(0, -${amount})`,
          right: `window.scrollBy(${amount}, 0)`,
          left: `window.scrollBy(-${amount}, 0)`,
          bottom: 'window.scrollTo(0, document.body.scrollHeight)',
          top: 'window.scrollTo(0, 0)',
        };
        await page.evaluate(dirMap[scroll_direction] || dirMap.down);
        const pos = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
        return { success: true, direction: scroll_direction, position: pos };
      }

      // ── hover ───────────────────────────────────────────────────────────
      case 'hover': {
        if (ref == null && !selector) return { success: false, error: 'ref or selector required' };
        const page = await ensurePage(headless);
        let el;
        if (ref != null) {
          el = await page.$(`[data-mref="${ref}"]`);
          if (!el) return { success: false, error: `Element [${ref}] not found` };
        } else {
          el = await page.$(selector);
          if (!el) return { success: false, error: `Selector "${selector}" not found` };
        }
        await el.hover();
        return { success: true, hovered: ref ?? selector };
      }

      // ── back / forward / reload ─────────────────────────────────────────
      case 'back': {
        const page = await ensurePage(headless);
        await page.goBack({ waitUntil: 'networkidle2', timeout });
        saveSession(page.url());
        return { success: true, url: page.url() };
      }
      case 'forward': {
        const page = await ensurePage(headless);
        await page.goForward({ waitUntil: 'networkidle2', timeout });
        saveSession(page.url());
        return { success: true, url: page.url() };
      }
      case 'reload': {
        const page = await ensurePage(headless);
        await page.reload({ waitUntil: 'networkidle2', timeout });
        saveSession(page.url());
        return { success: true, url: page.url() };
      }

      // ── get_text ────────────────────────────────────────────────────────
      case 'get_text': {
        const page = await ensurePage(headless);
        if (selector) {
          const el = await page.$(selector);
          if (!el) return { success: false, error: `Selector "${selector}" not found` };
          const text = await el.evaluate(e => e.textContent?.trim());
          return { success: true, text };
        }
        // Full page text
        const bodyText = await page.evaluate(() => document.body.innerText?.trim());
        return { success: true, text: bodyText?.slice(0, 10000) };
      }

      // ── get_url ─────────────────────────────────────────────────────────
      case 'get_url': {
        const page = await ensurePage(headless);
        const currentUrl = page.url();
        const title = await page.title();
        return { success: true, url: currentUrl, title };
      }

      // ── set_headers ─────────────────────────────────────────────────────
      case 'set_headers': {
        if (!headers) return { success: false, error: 'headers object required' };
        const page = await ensurePage(headless);
        await page.setExtraHTTPHeaders(headers);
        return { success: true, headers };
      }

      // ── set_geolocation ─────────────────────────────────────────────────
      case 'set_geolocation': {
        if (!geolocation) return { success: false, error: 'geolocation object required' };
        const page = await ensurePage(headless);
        const context = page.browser().defaultBrowserContext();
        await context.overridePermissions(page.url() || 'https://example.com', ['geolocation']);
        await page.setGeolocation(geolocation);
        return { success: true, geolocation };
      }

      // ── close ───────────────────────────────────────────────────────────
      case 'close': {
        if (_browser) {
          await _browser.close();
          _browser = null;
          _page = null;
          _elementRefs.clear();
          _refCounter = 0;
        }
        return { success: true, message: 'Browser closed' };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    // Attempt to clean up zombie browser on fatal error
    if (err.message?.includes('Target closed') || err.message?.includes('Session closed')) {
      _browser = null;
      _page = null;
      _elementRefs.clear();
    }
    return { success: false, error: err.message || String(err) };
  }
}
