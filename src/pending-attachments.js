// src/pending-attachments.js
// Shared queue for file attachments that should be sent with the next Discord response.
// Any tool can push file paths here, and discord.js drains the queue after each message.

const pendingFiles = [];

/**
 * Add a file path to the pending attachments queue.
 * @param {string} filePath - Absolute path to the file to attach
 */
export function addPendingAttachment(filePath) {
  pendingFiles.push(filePath);
}

/**
 * Drain and return all pending attachment file paths.
 * Clears the queue after reading.
 * @returns {string[]} Array of file paths
 */
export function drainPendingAttachments() {
  const files = [...pendingFiles];
  pendingFiles.length = 0;
  return files;
}

/**
 * Check if there are any pending attachments.
 * @returns {boolean}
 */
export function hasPendingAttachments() {
  return pendingFiles.length > 0;
}
