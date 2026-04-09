/**
 * CAPTCHA Solver Module
 * Uses Gemini Vision to solve CAPTCHAs via visual analysis.
 * Ported from: https://github.com/aydinnyunus/ai-captcha-bypass
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Gemini Vision Integration ──────────────────────────────────────────────

async function callGeminiVision(base64Image, prompt, mimeType = 'image/png') {
  const { GoogleGenAI } = await import('@google/genai');
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Image
          }
        },
        { text: prompt }
      ]
    }]
  });

  return response.text?.trim() || '';
}

// ── Prompts (from ai-captcha-bypass) ────────────────────────────────────────

const PROMPTS = {
  puzzleDistance: `You are looking at a puzzle CAPTCHA with a slider.
The puzzle piece needs to be moved horizontally to fit into the correct position.

Analyze the image and determine:
1. Where the puzzle piece currently is
2. Where the gap/target position is
3. How many pixels to move RIGHT (positive number) or LEFT (negative number)

Respond with ONLY a number (the pixel distance). Examples:
- If you need to move 120 pixels right, respond: 120
- If you need to move 50 pixels left, respond: -50

Do not explain, just give the number.`,

  puzzleCorrection: `You are looking at a puzzle CAPTCHA after an initial alignment attempt.
The slider has been moved, but it may not be perfectly aligned yet.

Look at the puzzle piece and the gap. Should the piece move:
- LEFT (to decrease the position)
- RIGHT (to increase the position)
- PERFECT (it's already aligned correctly)

Respond with ONLY one word: LEFT, RIGHT, or PERFECT`,

  puzzleBestFit: `You are looking at 3 screenshots of a puzzle CAPTCHA, each showing different slider positions.
The images are labeled [1], [2], and [3].

Analyze which position has the puzzle piece BEST ALIGNED with the gap.

Respond with ONLY the number of the best position: 1, 2, or 3`,

  recaptchaSelect: (target) => `You are looking at a reCAPTCHA v2 image grid challenge.
The task is to select all tiles that contain: ${target}

Analyze the grid and identify which tile numbers contain the target object.
Grid numbering:
- 3x3 grid: Top row is 0,1,2. Middle row is 3,4,5. Bottom row is 6,7,8.
- 4x4 grid: Top row is 0,1,2,3. Rows continue 4,5,6,7 then 8,9,10,11 then 12,13,14,15.

Respond with ONLY the tile numbers as a comma-separated list. Examples:
- If tiles 0, 4, and 7 contain the target: 0,4,7
- If only tile 5 contains it: 5
- If no tiles contain it: none`
};

// ── Human-like Drag Implementation ─────────────────────────────────────────

async function performHumanDrag(page, sliderElement, distance) {
  // Multi-stage drag with geometric progression and random pauses
  // This mimics human behavior and helps bypass bot detection
  
  const stages = [
    { fraction: 0.7, pause: 300 + Math.random() * 100 },
    { fraction: 0.2, pause: 300 + Math.random() * 100 },
    { fraction: 0.1, pause: 200 + Math.random() * 100 }
  ];

  const box = await sliderElement.boundingBox();
  if (!box) throw new Error('Cannot get slider bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Move mouse to slider and hold
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  let currentDistance = 0;

  for (const stage of stages) {
    const moveDistance = distance * stage.fraction;
    currentDistance += moveDistance;
    
    const targetX = startX + currentDistance;
    
    // Move with slight easing curve (not perfectly linear)
    const steps = 10 + Math.floor(Math.random() * 5);
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const eased = 1 - Math.pow(1 - progress, 2); // Ease-out quad
      const x = startX + currentDistance * eased;
      await page.mouse.move(x, startY);
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 10));
    }

    // Pause between stages (human-like)
    await new Promise(resolve => setTimeout(resolve, stage.pause));
  }

  // Release
  await page.mouse.up();
  
  // Small pause after release
  await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
}

// ── Puzzle CAPTCHA Solver ──────────────────────────────────────────────────

export async function solvePuzzleCaptcha(page, selector = null, maxAttempts = 3) {
  console.log('[CAPTCHA] Solving puzzle slider...');

  try {
    // Take screenshot of the puzzle area
    const screenshot = await page.screenshot({ encoding: 'base64', type: 'png' });

    // Ask Gemini for initial distance estimate
    console.log('[CAPTCHA] Analyzing puzzle position...');
    const distanceStr = await callGeminiVision(screenshot, PROMPTS.puzzleDistance, 'image/png');
    const distance = parseInt(distanceStr);

    if (isNaN(distance)) {
      return { success: false, error: `Gemini returned non-numeric distance: ${distanceStr}` };
    }

    console.log(`[CAPTCHA] Estimated distance: ${distance}px`);

    // Find the slider element (try common selectors if none provided)
    const sliderSelectors = selector ? [selector] : [
      '.geetest_slider_button',
      '.slider-button',
      '[class*="slider"]',
      'div[role="slider"]'
    ];

    let sliderElement = null;
    for (const sel of sliderSelectors) {
      sliderElement = await page.$(sel);
      if (sliderElement) break;
    }

    if (!sliderElement) {
      return { success: false, error: 'Could not find slider element on page' };
    }

    // Perform initial drag
    console.log('[CAPTCHA] Performing human-like drag...');
    await performHumanDrag(page, sliderElement, distance);

    // Wait for validation
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Check if solved (look for success indicators or absence of puzzle)
    const stillHasPuzzle = await page.evaluate(() => {
      // Common success/failure indicators
      const successSelectors = ['.geetest_success', '[class*="success"]'];
      const failureSelectors = ['.geetest_fail', '[class*="fail"]', '.geetest_slider_button'];
      
      for (const sel of successSelectors) {
        if (document.querySelector(sel)) return false; // Success found
      }
      for (const sel of failureSelectors) {
        if (document.querySelector(sel)) return true; // Still has puzzle
      }
      return false; // Assume success if no indicators found
    });

    if (!stillHasPuzzle) {
      console.log('[CAPTCHA] ✅ Puzzle solved on first attempt!');
      return { success: true, attempts: 1 };
    }

    // If first attempt failed, try correction loop
    console.log('[CAPTCHA] First attempt failed, refining...');

    for (let attempt = 2; attempt <= maxAttempts; attempt++) {
      const correctionScreenshot = await page.screenshot({ encoding: 'base64', type: 'png' });
      const direction = await callGeminiVision(correctionScreenshot, PROMPTS.puzzleCorrection, 'image/png');

      if (direction.toUpperCase().includes('PERFECT')) {
        console.log('[CAPTCHA] ✅ Puzzle aligned!');
        return { success: true, attempts: attempt };
      }

      const correctionDistance = direction.toUpperCase().includes('LEFT') ? -30 : 30;
      console.log(`[CAPTCHA] Attempt ${attempt}: Moving ${correctionDistance}px`);

      sliderElement = await page.$(sliderSelectors[0]);
      if (!sliderElement) break;

      await performHumanDrag(page, sliderElement, correctionDistance);
      await new Promise(resolve => setTimeout(resolve, 1500));

      const solved = await page.evaluate(() => {
        return !document.querySelector('.geetest_slider_button');
      });

      if (solved) {
        console.log(`[CAPTCHA] ✅ Solved on attempt ${attempt}!`);
        return { success: true, attempts: attempt };
      }
    }

    return { success: false, error: `Failed after ${maxAttempts} attempts`, attempts: maxAttempts };

  } catch (err) {
    console.error('[CAPTCHA] Error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── reCAPTCHA v2 Solver ─────────────────────────────────────────────────────

export async function solveRecaptchaV2(page, target = null) {
  console.log('[CAPTCHA] Solving reCAPTCHA v2...');

  try {
    // Switch to reCAPTCHA iframe
    const frames = page.frames();
    const recaptchaFrame = frames.find(f => f.url().includes('google.com/recaptcha'));
    
    if (!recaptchaFrame) {
      return { success: false, error: 'Could not find reCAPTCHA iframe' };
    }

    // Click the checkbox first (if not already showing challenge)
    const checkbox = await recaptchaFrame.$('.recaptcha-checkbox');
    if (checkbox) {
      console.log('[CAPTCHA] Clicking reCAPTCHA checkbox...');
      await checkbox.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Find the challenge iframe
    const challengeFrame = frames.find(f => f.url().includes('google.com/recaptcha') && f.url().includes('bframe'));
    
    if (!challengeFrame) {
      // Maybe it solved automatically?
      const solved = await page.evaluate(() => {
        const response = document.querySelector('[name="g-recaptcha-response"]');
        return response && response.value.length > 0;
      });
      
      if (solved) {
        console.log('[CAPTCHA] ✅ reCAPTCHA solved automatically!');
        return { success: true, auto: true };
      }
      
      return { success: false, error: 'No challenge iframe appeared' };
    }

    // Auto-detect challenge target if not provided
    if (!target) {
      const instructionText = await challengeFrame.$eval('.rc-imageselect-desc-no-canonical', el => el.textContent);
      target = instructionText?.match(/Select all images with (.+)/i)?.[1] || 'the target object';
      console.log(`[CAPTCHA] Detected target: ${target}`);
    }

    // Take screenshot of the challenge iframe (FIX: Use page.screenshot with clip)
    const challengeBox = await challengeFrame.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="bframe"]');
      if (!iframe) return null;
      const rect = iframe.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    });

    // Fallback: screenshot the whole page if we can't clip
    const screenshot = challengeBox 
      ? await page.screenshot({ encoding: 'base64', type: 'png', clip: challengeBox })
      : await page.screenshot({ encoding: 'base64', type: 'png' });

    // Ask Gemini which tiles to select
    console.log('[CAPTCHA] Analyzing reCAPTCHA tiles...');
    const tilesStr = await callGeminiVision(screenshot, PROMPTS.recaptchaSelect(target), 'image/png');

    if (tilesStr.toLowerCase() === 'none') {
      console.log('[CAPTCHA] No matching tiles found');
      return { success: false, error: 'No matching tiles' };
    }

    const tileNumbers = tilesStr.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    console.log(`[CAPTCHA] Selecting tiles: ${tileNumbers.join(', ')}`);

    // Click the tiles
    for (const tileNum of tileNumbers) {
      const tile = await challengeFrame.$(`td[tabindex="${tileNum + 4}"]`); // reCAPTCHA uses tabindex for tiles
      if (tile) {
        await tile.click();
        await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200));
      }
    }

    // Click verify button
    const verifyButton = await challengeFrame.$('#recaptcha-verify-button');
    if (verifyButton) {
      console.log('[CAPTCHA] Clicking verify...');
      await verifyButton.click();
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Check if solved
    const solved = await page.evaluate(() => {
      const response = document.querySelector('[name="g-recaptcha-response"]');
      return response && response.value.length > 0;
    });

    if (solved) {
      console.log('[CAPTCHA] ✅ reCAPTCHA solved!');
      return { success: true, tilesSelected: tileNumbers.length };
    }

    return { success: false, error: 'Verification failed' };

  } catch (err) {
    console.error('[CAPTCHA] reCAPTCHA error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Auto-detect CAPTCHA Type ────────────────────────────────────────────────

export async function detectCaptchaType(page) {
  return await page.evaluate(() => {
    // Puzzle slider CAPTCHAs
    if (document.querySelector('.geetest_slider') || 
        document.querySelector('[class*="slider"]') ||
        document.querySelector('.captcha-slider')) {
      return 'puzzle';
    }

    // reCAPTCHA v2
    if (document.querySelector('.g-recaptcha') ||
        document.querySelector('[name="g-recaptcha-response"]') ||
        document.querySelector('iframe[src*="google.com/recaptcha"]')) {
      return 'recaptcha_v2';
    }

    // Text CAPTCHA (simple OCR - not implemented yet)
    if (document.querySelector('img[alt*="captcha"]') ||
        document.querySelector('[class*="captcha"][class*="image"]')) {
      return 'text';
    }

    return 'unknown';
  });
}
