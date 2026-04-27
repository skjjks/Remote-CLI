import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isBinaryFile } from '../src/terminal/binary-detector';

describe('isBinaryFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'binary-detector-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('ASCII text file → false', () => {
    const p = join(tmpDir, 'ascii.txt');
    writeFileSync(p, 'hello world\nline 2\n');
    expect(isBinaryFile(p)).toBe(false);
  });

  test('UTF-8 with CJK → false', () => {
    const p = join(tmpDir, 'utf8.txt');
    writeFileSync(p, '你好世界\n中文注释\n');
    expect(isBinaryFile(p)).toBe(false);
  });

  test('file containing NUL byte → true', () => {
    const p = join(tmpDir, 'binary.bin');
    writeFileSync(p, Buffer.from([0x48, 0x00, 0x65, 0x6C, 0x6C, 0x6F]));
    expect(isBinaryFile(p)).toBe(true);
  });

  test('empty file → false (treat as empty-but-text-editable)', () => {
    const p = join(tmpDir, 'empty.txt');
    writeFileSync(p, '');
    expect(isBinaryFile(p)).toBe(false);
  });
});
