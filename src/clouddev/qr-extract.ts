/**
 * Extract URLs and authentication prompts from terminal capture text.
 * Used by the clouddev connector to detect SSH auth state.
 */

/**
 * Extract all HTTP/HTTPS URLs from terminal text.
 * Strips trailing punctuation that is not part of the URL.
 */
export function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = text.match(urlPattern);
  if (!matches) return [];

  return matches.map(url => {
    // Strip trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)}\]]+$/, '');
  });
}

/**
 * Analyze terminal text to detect what kind of authentication is being requested.
 *
 * Returns:
 * - `{ type: 'qrcode', url }` if a scannable URL is found
 * - `{ type: 'password' }` if a password prompt is detected
 * - `null` if no auth prompt is detected
 */
export function extractAuthInfo(text: string): { type: 'qrcode'; url: string } | { type: 'password' } | null {
  // Check for URL first (QR code auth typically has a URL)
  const urls = extractUrls(text);
  if (urls.length > 0) {
    return { type: 'qrcode', url: urls[0] };
  }

  // Check for password prompt
  if (/password\s*:/i.test(text)) {
    return { type: 'password' };
  }

  return null;
}
