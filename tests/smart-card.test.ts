import { describe, it, expect } from 'vitest';
import { SmartCardBuilder } from '../src/bot/card';

describe('SmartCardBuilder', () => {
  const builder = new SmartCardBuilder();

  describe('buildTextCard', () => {
    it('builds a card with markdown content', () => {
      const card = builder.buildTextCard('Hello world');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toBe('Claude');
      expect(parsed.elements.length).toBeGreaterThanOrEqual(1);
      const mdEl = parsed.elements.find((e: any) => e.tag === 'markdown');
      expect(mdEl).toBeDefined();
      expect(mdEl.content).toBe('Hello world');
    });
  });

  describe('buildToolCallCard', () => {
    it('builds a card for Bash tool with command', () => {
      const card = builder.buildToolCallCard('Bash', { command: 'ls -la' });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Bash');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasCommand = mdElements.some((e: any) => e.content.includes('ls -la'));
      expect(hasCommand).toBe(true);
    });

    it('builds a card for Edit tool with file path', () => {
      const card = builder.buildToolCallCard('Edit', { file_path: '/tmp/test.ts', old_string: 'foo', new_string: 'bar' });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Edit');
    });
  });

  describe('buildToolResultCard', () => {
    it('builds a card with short output', () => {
      const card = builder.buildToolResultCard('Bash', 'total 32\ndrwxr-xr-x 4 user', 1.2);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasOutput = mdElements.some((e: any) => e.content.includes('total 32'));
      expect(hasOutput).toBe(true);
    });

    it('truncates long output and adds note', () => {
      const longOutput = 'x'.repeat(3000);
      const card = builder.buildToolResultCard('Bash', longOutput, 2.0);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent.length).toBeLessThan(3000);
    });
  });

  describe('buildPermissionCard', () => {
    it('builds a card with Allow/Deny/Always Allow buttons', () => {
      const card = builder.buildPermissionCard('Bash', 'rm -rf node_modules');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Confirmation');
      const actionEl = parsed.elements.find((e: any) => e.tag === 'action');
      expect(actionEl).toBeDefined();
      expect(actionEl.actions.length).toBe(3);
      const values = actionEl.actions.map((a: any) => a.value);
      expect(values).toContain('__permit_allow__');
      expect(values).toContain('__permit_deny__');
      expect(values).toContain('__permit_always__');
    });
  });

  describe('buildCompletionCard', () => {
    it('builds a card with duration, cost, tokens', () => {
      const card = builder.buildCompletionCard({
        durationMs: 45000,
        costUsd: 0.15,
        inputTokens: 12345,
        outputTokens: 2345,
        numTurns: 3,
      });
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Complete');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent).toContain('45');
      expect(allContent).toContain('0.15');
    });
  });

  describe('buildTerminalOutputCard', () => {
    it('wraps output in a code block card', () => {
      const card = builder.buildTerminalOutputCard('$ ls\nfile.txt');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Terminal');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const hasCode = mdElements.some((e: any) => e.content.includes('```'));
      expect(hasCode).toBe(true);
    });
  });

  describe('buildInitCard', () => {
    it('builds a session started card', () => {
      const card = builder.buildInitCard('abc-123', 'opus');
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      expect(parsed.header.title.content).toContain('Session');
      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      const allContent = mdElements.map((e: any) => e.content).join('');
      expect(allContent).toContain('abc-123');
    });
  });
});
