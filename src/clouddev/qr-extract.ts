/**
 * Extract URLs and authentication prompts from terminal capture text.
 * Used by the clouddev connector to detect SSH auth state.
 */

/**
 * Rejoin URLs that were broken across lines by terminal line wrapping.
 * Terminal cols cause long URLs to wrap mid-word. Only joins when the
 * next line clearly continues a URL (starts with `=`, `&`, query params,
 * or a path-like segment like `e=` or `id=`), not English words.
 */
function rejoinWrappedUrls(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only rejoin if:
    // 1. Previous line ends with a partial URL
    // 2. This line starts with a URL query/path continuation pattern:
    //    - starts with =, &, ?, /, %, # (unambiguous URL chars)
    //    - starts with "key=" pattern (e.g., "e=songkang", "id=123")
    if (
      i > 0 &&
      result.length > 0 &&
      /https?:\/\/[^\s]+$/.test(result[result.length - 1]) &&
      /^([=&?/%#]|[a-zA-Z0-9_-]{1,20}[=&])/.test(line)
    ) {
      result[result.length - 1] += line;
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Extract all HTTP/HTTPS URLs from terminal text.
 * Handles URLs broken across lines by terminal wrapping.
 * Strips trailing punctuation that is not part of the URL.
 */
export function extractUrls(text: string): string[] {
  const rejoined = rejoinWrappedUrls(text);
  const urlPattern = /https?:\/\/[^\s<>"')\]]+/gi;
  const matches = rejoined.match(urlPattern);
  if (!matches) return [];

  return matches.map(url => {
    // Strip trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)}\]]+$/, '');
  });
}

/**
 * Analyze terminal text to detect what kind of authentication is being requested.
 * Prioritizes the QR scan URL (after "扫码登录") over other URLs like FAQ links.
 *
 * Returns:
 * - `{ type: 'qrcode', url }` if a scannable URL is found
 * - `{ type: 'password' }` if a password prompt is detected
 * - `null` if no auth prompt is detected
 */
export function extractAuthInfo(text: string): { type: 'qrcode'; url: string } | { type: 'password' } | null {
  const rejoined = rejoinWrappedUrls(text);

  // Look for the QR scan URL pattern: "扫码登录 <URL>" or "qr" in URL path
  const urls = extractUrls(text);
  const qrUrl = urls.find(u => /qr[./]/.test(u) || /scan/.test(u));
  if (qrUrl) {
    return { type: 'qrcode', url: qrUrl };
  }

  // Check for scan-related keyword near a URL
  if (/扫码/.test(rejoined) && urls.length > 0) {
    return { type: 'qrcode', url: urls[0] };
  }

  // Any URL present suggests auth screen
  if (urls.length > 0) {
    return { type: 'qrcode', url: urls[0] };
  }

  // Check for password prompt
  if (/password\s*:/i.test(text)) {
    return { type: 'password' };
  }

  return null;
}
