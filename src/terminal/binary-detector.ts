/**
 * Classify a file as binary vs. text by sampling its first 1024 bytes.
 *
 * Heuristic:
 *  - Any NUL byte (0x00) → binary (strings in C-like binaries, images, PDFs).
 *  - More than 5% of sampled bytes are "control" (< 0x09, or 0x0E-0x1F) → binary.
 *  - Empty file → text (user may want to write content into it).
 *
 * The 5% threshold tolerates occasional control bytes in UTF-8 encodings
 * while catching most real binaries (executables, images, archives).
 */

import { readFileSync } from 'node:fs';

export function isBinaryFile(path: string): boolean {
  const sample = readFileSync(path).subarray(0, 1024);
  if (sample.length === 0) return false;

  let controlCount = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0D && byte < 0x20)) controlCount++;
  }
  return controlCount / sample.length > 0.05;
}
