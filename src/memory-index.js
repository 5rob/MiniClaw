// ============================================================
// DEBOUNCED RE-INDEXING (v1.13)
// ============================================================
// Add these declarations near the top of memory-index.js (with other let declarations):
//
//   let reindexTimer = null;
//   let reindexDirty = false;
//   const REINDEX_DEBOUNCE_MS = 30_000; // 30 seconds
//
// Then add the following exported functions at the bottom of the file,
// AFTER the existing indexMemoryFiles and hybridSearch functions.
// ============================================================

// --- Debounced re-indexing ---
let reindexTimer = null;
let reindexDirty = false;
const REINDEX_DEBOUNCE_MS = 30_000; // 30 seconds

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
 *
 * @param {number} intervalMs - Re-index interval in milliseconds (default 300000 = 5 min)
 */
export function startPeriodicReindex(intervalMs = 300_000) {
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