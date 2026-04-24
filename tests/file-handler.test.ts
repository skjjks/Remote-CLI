import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockDownloadResource = vi.fn();
const mockSendText = vi.fn();
const mockSendCard = vi.fn();
const mockUploadFile = vi.fn();
const mockUploadImage = vi.fn();
const mockSendFileMessage = vi.fn();
const mockSendImageMessage = vi.fn();

vi.mock('../src/bot/feishu', () => ({
  getFeishuBot: () => ({
    downloadResource: mockDownloadResource,
    sendText: mockSendText,
    sendCard: mockSendCard,
    uploadFile: mockUploadFile,
    uploadImage: mockUploadImage,
    sendFileMessage: mockSendFileMessage,
    sendImageMessage: mockSendImageMessage,
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

import { handleFileUpload, handleFileOverwriteResponse, handleFileDownload } from '../src/handlers/file';
import { pendingFileUploads } from '../src/state';

describe('handleFileUpload', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
    mockUploadDir = tmpDir;
    mockDownloadResource.mockReset();
    mockSendText.mockReset();
    mockSendCard.mockReset();
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
    expect(mockSendCard).toHaveBeenCalled();
    expect(mockSendText).toHaveBeenCalledWith('chat_001', expect.stringContaining('reply 1 to overwrite'));
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

describe('handleFileDownload', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-test-'));
    mockUploadFile.mockReset();
    mockUploadImage.mockReset();
    mockSendFileMessage.mockReset();
    mockSendImageMessage.mockReset();
    mockSendText.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should send file for non-image files under 30MB', async () => {
    const filePath = path.join(tmpDir, 'report.pdf');
    fs.writeFileSync(filePath, 'a'.repeat(1000));
    mockUploadFile.mockResolvedValue('uploaded_key');

    await handleFileDownload('chat_001', filePath);

    expect(mockUploadFile).toHaveBeenCalledWith(filePath, 'report.pdf');
    expect(mockSendFileMessage).toHaveBeenCalledWith('chat_001', 'uploaded_key', 'report.pdf');
  });

  it('should send image for png files under 10MB', async () => {
    const filePath = path.join(tmpDir, 'screenshot.png');
    fs.writeFileSync(filePath, 'fake-png');
    mockUploadImage.mockResolvedValue('uploaded_img_key');

    await handleFileDownload('chat_001', filePath);

    expect(mockUploadImage).toHaveBeenCalledWith(filePath);
    expect(mockSendImageMessage).toHaveBeenCalledWith('chat_001', 'uploaded_img_key');
  });

  it('should show error for non-existent path', async () => {
    await handleFileDownload('chat_001', '/nonexistent/file.txt');

    expect(mockSendText).toHaveBeenCalledWith('chat_001', expect.stringContaining('not found'));
  });

  it('should pack directory into tar.gz and send', async () => {
    const dirPath = path.join(tmpDir, 'mydir');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, 'a.txt'), 'hello');
    mockUploadFile.mockResolvedValue('tar_key');

    await handleFileDownload('chat_001', dirPath);

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringContaining('mydir.tar.gz'),
      'mydir.tar.gz',
    );
    expect(mockSendFileMessage).toHaveBeenCalledWith('chat_001', 'tar_key', 'mydir.tar.gz');
  });

  it('should show scp hint for files over 30MB', async () => {
    const filePath = path.join(tmpDir, 'huge.bin');
    const fd = fs.openSync(filePath, 'w');
    fs.ftruncateSync(fd, 31 * 1024 * 1024);
    fs.closeSync(fd);

    await handleFileDownload('chat_001', filePath);

    expect(mockSendText).toHaveBeenCalledWith('chat_001', expect.stringContaining('scp'));
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
