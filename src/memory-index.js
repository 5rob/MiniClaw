// src/memory-index.js
// Hybrid BM25 + Vector search over memory files, OpenClaw-style
// Gracefully degrades to keyword-only if no embeddings available
// v1.13: Added debounced re-indexing (markDirty + startPeriodicReindex)
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DB_PATH = path.resolve('data/memory-index.sqlite');
const MEMORY_DIR = path.resolve('memory');

let db = null;
let config = null;

// --- Debounced re-indexing (v1.13) ---
let reindexTimer = null;
let reindexDirty = false;
const REINDEX_DEBOUNCE_MS = 30000; // 30 seconds

// --- Initialization ---

export function initMemoryIndex() {
  try {
    // Load config
    config = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL');

    // Create tables for file tracking, chunks, and FTS5
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        content_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        line_start INTEGER,
        line_end INTEGER,
        embedding BLOB,
        embedding_model TEXT,
        UNIQUE(file_id, chunk_index)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        content='chunks',
        content_rowid='id',
        tokenize='porter unicode61'
      );

      -- Triggers to keep FTS5 in sync with chunks table
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);

    console.log('[MemoryIndex] SQLite hybrid search initialized');
  } catch (err) {
    console.error('[MemoryIndex] Initialization failed:', err.message);
    throw err;
  }
}

// --- Chunking (OpenClaw-style: ~400 tokens per chunk, 80 token overlap) ---

function chunkText(text, chunkSize = 400, overlap = 80) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = [];
  let currentTokenEstimate = 0;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineTokens = Math.ceil(lines[i].length / 4); // rough token estimate
    currentChunk.push(lines[i]);
    currentTokenEstimate += lineTokens;

    if (currentTokenEstimate >= chunkSize) {
      chunks.push({
        content: currentChunk.join('\n'),
        lineStart,
        lineEnd: i
      });

      // Overlap: keep the last ~overlap tokens worth of lines
      let overlapTokens = 0;
      let overlapStart = currentChunk.length - 1;
      while (overlapStart > 0 && overlapTokens < overlap) {
        overlapTokens += Math.ceil(currentChunk[overlapStart].length / 4);
        overlapStart--;
      }

      lineStart = i - (currentChunk.length - 1 - overlapStart) + 1;
      currentChunk = currentChunk.slice(overlapStart + 1);
      currentTokenEstimate = overlapTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join('\n'),
      lineStart,
      lineEnd: lines.length - 1
    });
  }

  return chunks;
}

// --- Embedding (Voyage AI via fetch, optional) ---

async function getEmbeddings(texts) {
  // Use Voyage AI via direct fetch if VOYAGE_API_KEY is available
  // Falls back to null (keyword-only search) if no key or error
  try {
    if (!process.env.VOYAGE_API_KEY) {
      return texts.map(() => null);
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: texts,
        model: config?.memory?.embedding?.model || 'voyage-3-lite'
      })
    });

    if (!response.ok) {
      throw new Error(`Voyage API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data.data.map(d => new Float32Array(d.embedding));
  } catch (err) {
    console.warn('[MemoryIndex] Embedding failed, using keyword-only:', err.message);
    return texts.map(() => null);
  }
}

// --- Indexing ---

export async function indexMemoryFiles() {
  if (!db) initMemoryIndex();

  console.log('[MemoryIndex] Starting indexing...');

  const filesToIndex = [];

  try {
    // Collect all memory files
    const memoryMd = path.resolve('memory/MEMORY.md');
    if (fs.existsSync(memoryMd)) filesToIndex.push(memoryMd);

    const dailyDir = path.resolve('memory/daily');
    if (fs.existsSync(dailyDir)) {
      for (const f of fs.readdirSync(dailyDir).filter(f => f.endsWith('.md'))) {
        filesToIndex.push(path.join(dailyDir, f));
      }
    }

    // Also index SOUL.md and IDENTITY.md
    for (const f of ['SOUL.md', 'IDENTITY.md']) {
      const p = path.resolve(f);
      if (fs.existsSync(p)) filesToIndex.push(p);
    }

    const insertFile = db.prepare('INSERT OR REPLACE INTO files (path, content_hash, updated_at) VALUES (?, ?, ?)');
    const getFile = db.prepare('SELECT id, content_hash FROM files WHERE path = ?');
    const deleteChunks = db.prepare('DELETE FROM chunks WHERE file_id = ?');
    const insertChunk = db.prepare('INSERT INTO chunks (file_id, chunk_index, content, line_start, line_end, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)');

    let filesIndexed = 0;

    for (const filePath of filesToIndex) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hash = crypto.createHash('md5').update(content).digest('hex');

      // Check if file has changed (delta indexing like OpenClaw)
      const existing = getFile.get(filePath);
      if (existing && existing.content_hash === hash) continue;

      console.log(`[MemoryIndex] Indexing: ${path.relative('.', filePath)}`);
      filesIndexed++;

      // Upsert file record
      insertFile.run(filePath, hash, new Date().toISOString());
      const fileRow = getFile.get(filePath);

      // Delete old chunks
      deleteChunks.run(fileRow.id);

      // Chunk and embed
      const chunks = chunkText(content, config?.memory?.embedding?.chunkSize || 400, config?.memory?.embedding?.chunkOverlap || 80);
      const embeddings = await getEmbeddings(chunks.map(c => c.content));

      // Insert chunks in a transaction
      const insertMany = db.transaction(() => {
        for (let i = 0; i < chunks.length; i++) {
          const embeddingBlob = embeddings[i] ? Buffer.from(embeddings[i].buffer) : null;
          insertChunk.run(
            fileRow.id,
            i,
            chunks[i].content,
            chunks[i].lineStart,
            chunks[i].lineEnd,
            embeddingBlob,
            embeddings[i] ? (config?.memory?.embedding?.model || 'voyage-3-lite') : null
          );
        }
      });
      insertMany();
    }

    if (filesIndexed === 0) {
      console.log('[MemoryIndex] No changes detected, index up to date');
    } else {
      console.log(`[MemoryIndex] Indexed ${filesIndexed} file(s)`);
    }
  } catch (err) {
    console.error('[MemoryIndex] Indexing error:', err.message);
    throw err;
  }
}

// --- Debounced Re-indexing (v1.13) ---

/**
 * Mark the memory index as needing a refresh.
 * Called after memory writes instead of indexMemoryFiles() directly.
 *
 * Uses a non-resetting timer: the first dirty mark starts a 30s countdown.
 * Subsequent dirty marks within that window do NOT reset the timer.
 * This guarantees a max 30s wait from the first change, not from the last.
 */
export function markDirty() {
  reindexDirty = true;

  // If no timer is running, start one
  if (!reindexTimer) {
    reindexTimer = setTimeout(async () => {
      reindexTimer = null;
      if (reindexDirty) {
        reindexDirty = false;
        console.log('[MemoryIndex] Debounced re-index triggered');
        try {
          await indexMemoryFiles();
        } catch (err) {
          console.error('[MemoryIndex] Debounced re-index failed:', err.message);
        }
      }
    }, REINDEX_DEBOUNCE_MS);
  }
}

/**
 * Start a periodic re-index interval. Call once at startup.
 * Runs unconditionally (not gated behind dirty flag) to catch:
 * - File changes made outside the bot (manual edits to MEMORY.md)
 * - Edge cases where markDirty() wasn't triggered
 * Matches OpenClaw's QMD backend pattern (default every 5 minutes).
 */
export function startPeriodicReindex(intervalMs = 300000) {
  setInterval(async () => {
    console.log('[MemoryIndex] Periodic re-index');
    try {
      await indexMemoryFiles();
    } catch (err) {
      console.error('[MemoryIndex] Periodic re-index failed:', err.message);
    }
  }, intervalMs);
  console.log(`[MemoryIndex] Periodic re-index every ${intervalMs / 1000}s`);
}

// --- Hybrid Search (BM25 + Vector with RRF fusion) ---

export async function hybridSearch(query, maxResults = 10) {
  if (!db) initMemoryIndex();

  try {
    // 1. BM25 keyword search via FTS5
    const ftsResults = db.prepare(`
      SELECT chunks.id, chunks.content, chunks.line_start, chunks.line_end,
           files.path, bm25(chunks_fts) as bm25_score
      FROM chunks_fts
      JOIN chunks ON chunks.id = chunks_fts.rowid
      JOIN files ON files.id = chunks.file_id
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts)
      LIMIT ?
    `).all(ftsTokenize(query), maxResults * 2);

    // 2. Vector search (if embeddings available)
    let vectorResults = [];
    const queryEmbeddings = await getEmbeddings([query]);
    const queryVec = queryEmbeddings[0];

    if (queryVec) {
      // Get all chunks with embeddings and compute cosine similarity
      const allChunks = db.prepare(`
        SELECT chunks.id, chunks.content, chunks.line_start, chunks.line_end,
             files.path, chunks.embedding
        FROM chunks
        JOIN files ON files.id = chunks.file_id
        WHERE chunks.embedding IS NOT NULL
      `).all();

      vectorResults = allChunks.map(chunk => {
        const chunkVec = new Float32Array(chunk.embedding.buffer);
        const similarity = cosineSimilarity(queryVec, chunkVec);
        return {
          id: chunk.id,
          content: chunk.content,
          line_start: chunk.line_start,
          line_end: chunk.line_end,
          path: chunk.path,
          vector_score: similarity
        };
      }).sort((a, b) => b.vector_score - a.vector_score).slice(0, maxResults * 2);
    }

    // 3. Reciprocal Rank Fusion (RRF) — OpenClaw uses union, not intersection
    const k = 60; // RRF constant
    const scores = new Map();

    ftsResults.forEach((r, rank) => {
      const key = r.id;
      const current = scores.get(key) || { ...r, score: 0 };
      current.score += 1 / (k + rank + 1);
      scores.set(key, current);
    });

    vectorResults.forEach((r, rank) => {
      const key = r.id;
      const current = scores.get(key) || { ...r, score: 0 };
      current.score += 1 / (k + rank + 1);
      scores.set(key, current);
    });

    // Sort by fused score, return top results
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(r => ({
        content: r.content,
        source: path.relative('.', r.path),
        lines: `${r.line_start}-${r.line_end}`,
        score: r.score
      }));
  } catch (err) {
    console.error('[MemoryIndex] Hybrid search error:', err.message);
    // Graceful fallback: return empty results
    return [];
  }
}

// Convert a natural language query into FTS5-safe tokens
function ftsTokenize(query) {
  // FTS5 requires special syntax — wrap each word to avoid operator conflicts
  return query
    .replace(/[^\w\s]/g, '') // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 1)
    .map(w => `"${w}"`)
    .join(' OR ');
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}