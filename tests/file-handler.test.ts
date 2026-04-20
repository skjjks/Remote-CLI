import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockDownloadResource = vi.fn();
const mockSendText = vi.fn();

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({
    downloadResource: mockDownloadResource,
    sendText: mockSendText,
  }),
}));

let mockUploadDir = '';

vi.mock('../src/config', () => ({
  getConfig: () => ({
    upload: { get dir() { return mockUploadDir; } },
  }),
}));

vi.mock('../src/state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/state')>();
  return {
    ...original,
    pendingFileUploads: new Map(),
  };
});

import { handleFileUpload, handleFileOverwriteResponse } from '../src/handlers/file';
import { pendingFileUploads } from '../src/state';

describe('handleFileUpload', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
    mockUploadDir = tmpDir;
    mockDownloadResource.mockReset();
    mockSendText.mockReset();
    pendingFileUploads.clear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should download file and save to upload dir', async () => {
    mockDownloadResource.mockImplementation((messageId, fileKey, resourceType, destPath) => {
      // Mock the file write by creating a dummy file
      fs.writeFileSync(destPath, 'file content');
      return Promise.resolve();
    });

    await handleFileUpload('chat_001', 'msg_001', 'file_key_abc', 'report.pdf', 'file');

    const expectedPath = path.join(tmpDir, 'report.pdf');
    expect(mockDownloadResource).toHaveBeenCalledWith('msg_001', 'file_key_abc', 'file', expectedPath);
    expect(mockSendText).toHaveBeenCalledWith('chat_001', expect.stringContaining('report.pdf'));
  });

  it('should ask for overwrite when file already exists', async () => {
    const existingFile = path.join(tmpDir, 'report.pdf');
    fs.writeFileSync(existingFile, 'existing content');

    await handleFileUpload('chat_001', 'msg_001', 'file_key_abc', 'report.pdf', 'file');

    expect(mockDownloadResource).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith('chat_001', expect.stringContaining('already exists'));
    expect(pendingFileUploads.has('chat_001')).toBe(true);
  });

  it('should create upload dir if it does not exist', async () => {
    const nestedDir = path.join(tmpDir, 'sub', 'dir');
    mockUploadDir = nestedDir;
    mockDownloadResource.mockImplementation((messageId, fileKey, resourceType, destPath) => {
      // Mock the file write by creating a dummy file
      fs.writeFileSync(destPath, 'file content');
      return Promise.resolve();
    });

    await handleFileUpload('chat_001', 'msg_001', 'file_key_abc', 'test.txt', 'file');

    expect(fs.existsSync(nestedDir)).toBe(true);
  });
});

describe('handleFileOverwriteResponse', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'overwrite-test-'));
    mockUploadDir = tmpDir;
    mockDownloadResource.mockReset();
    mockSendText.mockReset();
    pendingFileUploads.clear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return false when no pending upload', async () => {
    const result = await handleFileOverwriteResponse('chat_001', '1');
    expect(result).toBe(false);
  });

  it('should overwrite file when user replies 1', async () => {
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'old content');
    pendingFileUploads.set('chat_001', {
      messageId: 'msg_001',
      fileKey: 'file_key_abc',
      fileName: 'test.txt',
      resourceType: 'file',
    });
    mockDownloadResource.mockImplementation((messageId, fileKey, resourceType, destPath) => {
      // Mock the file write by creating a dummy file
      fs.writeFileSync(destPath, 'new content');
      return Promise.resolve();
    });

    const result = await handleFileOverwriteResponse('chat_001', '1');

    expect(result).toBe(true);
    expect(mockDownloadResource).toHaveBeenCalled();
    expect(pendingFileUploads.has('chat_001')).toBe(false);
  });

  it('should cancel upload when user replies 0', async () => {
    pendingFileUploads.set('chat_001', {
      messageId: 'msg_001',
      fileKey: 'file_key_abc',
      fileName: 'test.txt',
      resourceType: 'file',
    });

    const result = await handleFileOverwriteResponse('chat_001', '0');

    expect(result).toBe(true);
    expect(mockDownloadResource).not.toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith('chat_001', 'Upload cancelled.');
    expect(pendingFileUploads.has('chat_001')).toBe(false);
  });
});
