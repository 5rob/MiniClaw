// src/gemini.js
// Gemini API integration — vision (image understanding) and image generation
// v2.1: Uses @google/genai SDK, correct model names
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let ai = null;

function getClient() {
  if (!ai && GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return ai;
}

// --- Vision (image understanding) ---
const VISION_MODEL = 'gemini-2.5-flash';

// Supported image types
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'];

/**
 * Check if a Discord attachment is an image we can process.
 */
export function isImageAttachment(attachment) {
  if (attachment.contentType && IMAGE_MIME_TYPES.includes(attachment.contentType)) {
    return true;
  }
  const ext = path.extname(attachment.name || '').toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get the MIME type for an image attachment.
 */
export function getImageMimeType(attachment) {
  if (attachment.contentType && IMAGE_MIME_TYPES.includes(attachment.contentType)) {
    return attachment.contentType;
  }
  const ext = path.extname(attachment.name || '').toLowerCase();
  const mimeMap = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
  };
  return mimeMap[ext] || 'image/png';
}

/**
 * Describe an image using Gemini Vision.
 * @param {string} imageUrl - URL to fetch the image from
 * @param {string} mimeType - MIME type of the image
 * @returns {string|null} Description, or null on failure
 */
export async function describeImage(imageUrl, mimeType) {
  const client = getClient();
  if (!client) {
    console.warn('[Vision] No GEMINI_API_KEY — skipping');
    return null;
  }

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.error(`[Vision] Failed to fetch image: ${imageResponse.status}`);
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    const response = await client.models.generateContent({
      model: VISION_MODEL,
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/png',
              data: base64Image
            }
          },
          {
            text: 'Describe this image concisely but thoroughly. Include key details: what it shows, any text visible, colors, composition, mood. If it\'s a screenshot, describe the UI/content. If it\'s a meme or joke, explain it. If it\'s a famous character or reference, identify it. Keep it to 2-4 sentences unless the image is complex.'
          }
        ]
      }]
    });

    const description = response.text?.trim();

    if (description) {
      console.log(`[Vision] Described: "${description.slice(0, 100)}..."`);
      return description;
    }

    console.warn('[Vision] Gemini returned no description');
    return null;
  } catch (err) {
    console.error('[Vision] Error:', err.message);
    return null;
  }
}


// --- Image Generation ---
const GENERATION_MODEL = 'gemini-2.5-flash-image';
const TEMP_DIR = path.resolve('temp');

/**
 * Generate an image using Gemini's Nano Banana image generation.
 * @param {string} prompt - Text description of what to generate
 * @param {string} aspectRatio - Optional: '1:1', '16:9', '9:16', '4:3', '3:4'
 * @returns {{ filePath: string, description: string } | { error: string }}
 */
export async function generateImage(prompt, aspectRatio = '1:1') {
  const client = getClient();
  if (!client) {
    return { error: 'No GEMINI_API_KEY configured — cannot generate images.' };
  }

  try {
    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    console.log(`[ImageGen] Generating: "${prompt.slice(0, 80)}..." (${aspectRatio})`);

    const response = await client.models.generateContent({
      model: GENERATION_MODEL,
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: aspectRatio,
          imageSize: '1K'
        }
      }
    });

    const candidate = response.candidates?.[0];

    if (!candidate?.content?.parts) {
      console.error('[ImageGen] No parts in response');
      return { error: 'Gemini returned no content.' };
    }

    // Extract image and text parts from the response
    let imageData = null;
    let imageMimeType = 'image/png';
    let textResponse = '';

    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        imageData = part.inlineData.data; // base64
        imageMimeType = part.inlineData.mimeType || 'image/png';
      }
      if (part.text) {
        textResponse += part.text;
      }
    }

    if (!imageData) {
      // Gemini sometimes returns only text (e.g., if it refuses to generate)
      console.warn('[ImageGen] No image data in response. Text:', textResponse);
      return { error: textResponse || 'Gemini did not generate an image. It may have refused the prompt.' };
    }

    // Save to temp file
    const ext = imageMimeType === 'image/jpeg' ? '.jpg' : '.png';
    const filename = `generated_${Date.now()}${ext}`;
    const filePath = path.join(TEMP_DIR, filename);

    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);

    console.log(`[ImageGen] Saved: ${filePath} (${(buffer.length / 1024).toFixed(1)}KB)`);

    return {
      filePath,
      filename,
      description: textResponse || 'Image generated successfully.',
      sizeKB: (buffer.length / 1024).toFixed(1)
    };
  } catch (err) {
    console.error('[ImageGen] Error:', err.message);
    return { error: `Image generation failed: ${err.message}` };
  }
}

/**
 * Clean up old temp files (call periodically or after sending)
 */
export function cleanupTempFiles(maxAgeMs = 300000) { // Default: 5 minutes
  if (!fs.existsSync(TEMP_DIR)) return;

  try {
    const files = fs.readdirSync(TEMP_DIR);
    const now = Date.now();

    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        console.log(`[ImageGen] Cleaned up: ${file}`);
      }
    }
  } catch (err) {
    console.error('[ImageGen] Cleanup error:', err.message);
  }
}

/**
 * Check if Gemini is available (API key configured)
 */
export function isGeminiEnabled() {
  return !!GEMINI_API_KEY;
}
