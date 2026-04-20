import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
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

  const safeName = path.basename(fileName);
  const destPath = path.join(uploadDir, safeName);

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
    const destPath = path.join(config.upload.dir, path.basename(pending.fileName));
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

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_SIZE = 30 * 1024 * 1024;

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function handleFileDownload(
  conversationId: string,
  targetPath: string,
): Promise<void> {
  const feishuBot = getFeishuBot();

  const resolvedPath = targetPath.startsWith('~')
    ? path.join(os.homedir(), targetPath.slice(1))
    : targetPath;

  if (!fs.existsSync(resolvedPath)) {
    await feishuBot.sendText(conversationId, `File not found: ${targetPath}`);
    return;
  }

  const stats = fs.statSync(resolvedPath);
  let filePath = resolvedPath;
  let fileName = path.basename(resolvedPath);
  let tmpTar: string | null = null;

  if (stats.isDirectory()) {
    const tarName = `${fileName}.tar.gz`;
    tmpTar = path.join(os.tmpdir(), tarName);
    try {
      execSync(`tar -czf "${tmpTar}" -C "${path.dirname(resolvedPath)}" "${fileName}"`, {
        timeout: 60000,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await feishuBot.sendText(conversationId, `Failed to pack directory: ${msg}`);
      return;
    }
    filePath = tmpTar;
    fileName = tarName;
  }

  try {
    const fileStats = fs.statSync(filePath);
    const fileSize = fileStats.size;

    if (isImageFile(filePath) && fileSize <= MAX_IMAGE_SIZE) {
      const imageKey = await feishuBot.uploadImage(filePath);
      await feishuBot.sendImageMessage(conversationId, imageKey);
    } else if (fileSize <= MAX_FILE_SIZE) {
      const fileKey = await feishuBot.uploadFile(filePath, fileName);
      await feishuBot.sendFileMessage(conversationId, fileKey, fileName);
    } else {
      await feishuBot.sendText(
        conversationId,
        `File exceeds Feishu 30MB limit (current: ${formatSize(fileSize)})\nUse: scp ${os.userInfo().username}@${os.hostname()}:${resolvedPath} ./`,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await feishuBot.sendText(conversationId, `Failed to send file: ${msg}`);
  } finally {
    if (tmpTar && fs.existsSync(tmpTar)) {
      fs.unlinkSync(tmpTar);
    }
  }
}
