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

    it('splits long text into multiple markdown elements', () => {
      // Build a string with paragraph breaks that exceeds the limit
      const paragraph = 'Lorem ipsum dolor sit amet.\n\n';
      const longText = paragraph.repeat(500); // ~14000 chars
      const card = builder.buildTextCard(longText);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      expect(mdElements.length).toBeGreaterThan(1);
      // All original content should be preserved across chunks
      const allContent = mdElements.map((e: any) => e.content).join('\n\n');
      expect(allContent).toContain('Lorem ipsum');
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

    it('splits long output into multiple markdown elements', () => {
      const longOutput = 'x'.repeat(15000);
      const card = builder.buildToolResultCard('Bash', longOutput, 2.0);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      // Should split into multiple markdown elements (15000 / 10000 = 2 chunks)
      expect(mdElements.length).toBeGreaterThan(1);
      // Each element should be wrapped in code fences
      for (const el of mdElements) {
        expect(el.content).toMatch(/^```\n/);
        expect(el.content).toMatch(/\n```$/);
      }
      // All content should be preserved (no truncation)
      const allInner = mdElements.map((e: any) => e.content.replace(/^```\n/, '').replace(/\n```$/, '')).join('');
      expect(allInner.length).toBe(15000);
    });

    it('does not split short output', () => {
      const shortOutput = 'x'.repeat(5000);
      const card = builder.buildToolResultCard('Bash', shortOutput, 1.0);
      const json = JSON.stringify(card);
      const parsed = JSON.parse(json);

      const mdElements = parsed.elements.filter((e: any) => e.tag === 'markdown');
      expect(mdElements.length).toBe(1);
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

  describe('stripAnsi', () => {
    it('strips color codes', () => {
      const input = '\x1b[32m✓\x1b[0m test passed';
      const card = builder.buildTerminalOutputCard(input);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).not.toContain('\x1b');
      expect(md.content).toContain('✓');
      expect(md.content).toContain('test passed');
    });

    it('strips cursor movement codes', () => {
      const input = '\x1b[2J\x1b[Hsome output';
      const card = builder.buildTerminalOutputCard(input);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).not.toContain('\x1b');
      expect(md.content).toContain('some output');
    });

    it('leaves clean text unchanged', () => {
      const input = 'hello world';
      const card = builder.buildTerminalOutputCard(input);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toContain('hello world');
    });
  });

  describe('detectOutputLanguage', () => {
    it('detects JSON output', () => {
      const jsonOutput = '{\n  "name": "test",\n  "version": "1.0"\n}';
      const card = builder.buildTerminalOutputCard(jsonOutput);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toMatch(/^```json\n/);
    });

    it('detects JSON array output', () => {
      const jsonOutput = '[\n  {"id": 1},\n  {"id": 2}\n]';
      const card = builder.buildTerminalOutputCard(jsonOutput);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toMatch(/^```json\n/);
    });

    it('detects diff output', () => {
      const diffOutput = 'diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line\n old line';
      const card = builder.buildTerminalOutputCard(diffOutput);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toMatch(/^```diff\n/);
    });

    it('detects YAML output', () => {
      const yamlOutput = '---\nname: test\nversion: 1.0\nkeys:\n  - alpha\n  - beta';
      const card = builder.buildTerminalOutputCard(yamlOutput);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toMatch(/^```yaml\n/);
    });

    it('defaults to bash for plain terminal output', () => {
      const plainOutput = 'total 32\ndrwxr-xr-x 4 user staff 128 Apr 10 file1\n-rw-r--r-- 1 user staff 256 Apr 10 file2';
      const card = builder.buildTerminalOutputCard(plainOutput);
      const md = card.elements.find((e: any) => e.tag === 'markdown');
      expect(md.content).toMatch(/^```bash\n/);
    });
  });
});
