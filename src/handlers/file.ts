import fs from 'fs';
import path from 'path';
import { getFeishuBot } from '../bot/feishu';
import { getConfig } from '../config';
import { pendingFileUploads } from '../state';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export async function handleFileUpload(
  conversationId: string,
  messageId: string,
  fileKey: string,
  fileName: string,
  resourceType: 'file' | 'image',
): Promise<void> {
  const feishuBot = getFeishuBot();
  const config = getConfig();
  const uploadDir = config.upload.dir;

  ensureDir(uploadDir);

  const destPath = path.join(uploadDir, fileName);

  if (fs.existsSync(destPath)) {
    pendingFileUploads.set(conversationId, {
      messageId,
      fileKey,
      fileName,
      resourceType,
    });
    await feishuBot.sendText(
      conversationId,
      `File ${fileName} already exists. Reply 1 to overwrite, 0 to cancel.`,
    );
    return;
  }

  await downloadAndSave(conversationId, messageId, fileKey, resourceType, destPath, fileName);
}

export async function handleFileOverwriteResponse(
  conversationId: string,
  response: string,
): Promise<boolean> {
  const pending = pendingFileUploads.get(conversationId);
  if (!pending) return false;

  const feishuBot = getFeishuBot();
  const config = getConfig();
  pendingFileUploads.delete(conversationId);

  if (response === '1') {
    const destPath = path.join(config.upload.dir, pending.fileName);
    await downloadAndSave(
      conversationId,
      pending.messageId,
      pending.fileKey,
      pending.resourceType,
      destPath,
      pending.fileName,
    );
  } else {
    await feishuBot.sendText(conversationId, 'Upload cancelled.');
  }
  return true;
}

async function downloadAndSave(
  conversationId: string,
  messageId: string,
  fileKey: string,
  resourceType: 'file' | 'image',
  destPath: string,
  fileName: string,
): Promise<void> {
  const feishuBot = getFeishuBot();
  try {
    await feishuBot.downloadResource(messageId, fileKey, resourceType, destPath);
    const stats = fs.statSync(destPath);
    await feishuBot.sendText(
      conversationId,
      `File saved\nPath: ${destPath}\nSize: ${formatSize(stats.size)}`,
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await feishuBot.sendText(conversationId, `Failed to save file: ${msg}`);
  }
}
