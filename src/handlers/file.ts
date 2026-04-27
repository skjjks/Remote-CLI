import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { getFeishuBot } from '../bot/feishu';
import { getConfig } from '../config';
import { pendingFileUploads, lastRequester, smartCard } from '../state';
import { isBinaryFile } from '../terminal/binary-detector';

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

    const requesterOpenId = lastRequester.get(conversationId) ?? '';
    const card = smartCard.buildConfirmCardV2({
      title: '📁 File already exists',
      headerTemplate: 'orange',
      bodyMarkdown: `\`${fileName}\` already exists in \`${uploadDir}\`.\n\nOverwrite?`,
      buttons: [
        {
          label: 'Overwrite',
          variant: 'danger',
          value: { kind: 'fileOverwrite', conversationId, choice: 'overwrite', requesterOpenId },
        },
        {
          label: 'Cancel',
          variant: 'default',
          value: { kind: 'fileOverwrite', conversationId, choice: 'cancel', requesterOpenId },
        },
      ],
    });
    await feishuBot.sendCard(conversationId, card);
    // Text fallback prompt — still sent so digit replies remain a valid path.
    await feishuBot.sendText(
      conversationId,
      `(Or reply 1 to overwrite, 0 to cancel.)`,
    );
    return;
  }

  await downloadAndSave(conversationId, messageId, fileKey, resourceType, destPath);
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
  } catch (error: unknown) {
    const axiosErr = error as any;
    const code = axiosErr?.response?.data?.code;
    const apiMsg = axiosErr?.response?.data?.msg;
    const fallback = error instanceof Error ? error.message : String(error);
    console.error('[FILE] Download error:', code, apiMsg, fallback);
    await feishuBot.sendText(conversationId, `Failed to send file: ${apiMsg || fallback}`);
  } finally {
    if (tmpTar && fs.existsSync(tmpTar)) {
      fs.unlinkSync(tmpTar);
    }
  }
}

export async function handleEdit(conversationId: string, pathArg?: string): Promise<void> {
  const feishuBot = getFeishuBot();

  if (!pathArg) {
    await feishuBot.sendText(conversationId, 'Usage: !edit <file>');
    return;
  }

  const filePath = pathArg;

  if (!fs.existsSync(filePath)) {
    await feishuBot.sendText(
      conversationId,
      `File not found: ${filePath}\nTry: !sh touch ${filePath}`,
    );
    return;
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    await feishuBot.sendText(conversationId, `Not a regular file: ${filePath}`);
    return;
  }

  if (isBinaryFile(filePath)) {
    await feishuBot.sendText(conversationId, `Cannot edit binary file: ${filePath}`);
    return;
  }

  if (stat.size > 1000) {
    await feishuBot.sendText(
      conversationId,
      `File too large (${stat.size} bytes, limit 1000).\nUse: !sh vim ${filePath}`,
    );
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    await feishuBot.sendText(
      conversationId,
      `Cannot read file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const requesterOpenId = lastRequester.get(conversationId) ?? '';
  const card = smartCard.buildEditFormCard({ path: filePath, content, requesterOpenId });
  await feishuBot.sendCard(conversationId, card);
}
