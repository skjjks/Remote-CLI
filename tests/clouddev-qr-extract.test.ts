import { describe, it, expect } from 'vitest';
import { extractUrls, extractAuthInfo } from '../src/clouddev/qr-extract';

describe('clouddev/qr-extract', () => {
  describe('extractUrls', () => {
    it('extracts https URL from terminal text', () => {
      const text = `
Please scan the QR code or visit:
https://auth.xiaomi.com/verify?token=abc123
to complete authentication.
`;
      const urls = extractUrls(text);
      expect(urls).toEqual(['https://auth.xiaomi.com/verify?token=abc123']);
    });

    it('extracts http URL', () => {
      const text = 'Visit http://example.com/login to authenticate';
      const urls = extractUrls(text);
      expect(urls).toEqual(['http://example.com/login']);
    });

    it('extracts multiple URLs', () => {
      const text = `
URL1: https://auth.example.com/a
URL2: https://auth.example.com/b
`;
      const urls = extractUrls(text);
      expect(urls).toHaveLength(2);
    });

    it('returns empty array when no URLs found', () => {
      const text = 'No URLs here, just regular text\nwith multiple lines';
      const urls = extractUrls(text);
      expect(urls).toEqual([]);
    });

    it('strips trailing punctuation from URLs', () => {
      const text = 'Visit https://auth.example.com/verify?t=123.';
      const urls = extractUrls(text);
      expect(urls).toEqual(['https://auth.example.com/verify?t=123']);
    });

    it('handles URLs mixed with QR block characters', () => {
      const text = `
█▀▀▀█ ████ █▀▀▀█
█ ██ █ ████ █ ██ █
https://relay.xiaomi.com/auth/scan?id=xyz789
█▄▄▄█ ████ █▄▄▄█
`;
      const urls = extractUrls(text);
      expect(urls).toEqual(['https://relay.xiaomi.com/auth/scan?id=xyz789']);
    });
  });

  describe('extractAuthInfo', () => {
    it('detects qrcode auth when URL is present', () => {
      const text = `
Scan QR code:
█▀▀▀█ ████
https://auth.xiaomi.com/scan?id=abc
█▄▄▄█ ████
`;
      const info = extractAuthInfo(text);
      expect(info).toEqual({
        type: 'qrcode',
        url: 'https://auth.xiaomi.com/scan?id=abc',
      });
    });

    it('detects password prompt', () => {
      const text = `
liujialei@relay.xiaomi.com's password: `;
      const info = extractAuthInfo(text);
      expect(info).toEqual({ type: 'password' });
    });

    it('detects Password with capital P', () => {
      const text = 'Password: ';
      const info = extractAuthInfo(text);
      expect(info).toEqual({ type: 'password' });
    });

    it('returns null when no auth prompt detected', () => {
      const text = 'Welcome to Ubuntu 22.04\nuser@host:~$ ';
      const info = extractAuthInfo(text);
      expect(info).toBeNull();
    });
  });
});
