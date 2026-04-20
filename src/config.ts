import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Load environment variables
dotenv.config();

export interface Config {
  feishu: {
    appId: string;
    appSecret: string;
  };
  security: {
    allowedUsers: string[];
  };
  server: {
    port: number;
    host: string;
  };
  terminal: {
    cols: number;
    rows: number;
    shell: string;
    historyLimit: number;
  };
  session: {
    prefix: string;
    dataDir: string;
    staleTimeout: number;
    cleanupInterval: number;
  };
  claude: {
    timeout: number;
    defaultMode: 'default' | 'auto';
    cardUpdateInterval: number;
    permissionTimeout: number;
  };
  opencode: {
    timeout: number;
    defaultMode: 'default' | 'auto';
    cardUpdateInterval: number;
    permissionTimeout: number;
  };
  timing: {
    shellCaptureDelay: number;
    rawModeCaptureDelay: number;
    claudeStartupWait: number;
    claudePollInterval: number;
    claudeFirstPollDelay: number;
    claudeMenuPollDelay: number;
  };
  clouddev: {
    username: string;
    imageType: string;
    relayHost: string;
    emailPassword: string;
  };
  upload: {
    dir: string;
  };
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvVarArray(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

function getEnvVarInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer: ${value}`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    feishu: {
      appId: getEnvVar('FEISHU_APP_ID'),
      appSecret: getEnvVar('FEISHU_APP_SECRET'),
    },
    security: {
      allowedUsers: getEnvVarArray('ALLOWED_USERS'),
    },
    server: {
      port: getEnvVarInt('PORT', 3000),
      host: getEnvVar('HOST', '0.0.0.0'),
    },
    terminal: {
      cols: getEnvVarInt('TERMINAL_COLS', 200),
      rows: getEnvVarInt('TERMINAL_ROWS', 24),
      shell: getEnvVar('SHELL', '/bin/bash'),
      historyLimit: getEnvVarInt('TERMINAL_HISTORY_LIMIT', 50000),
    },
    session: {
      prefix: getEnvVar('SESSION_PREFIX', 'remote-cli'),
      dataDir: getEnvVar('DATA_DIR', path.join(process.cwd(), 'data')),
      staleTimeout: getEnvVarInt('SESSION_STALE_TIMEOUT', 86400000),
      cleanupInterval: getEnvVarInt('SESSION_CLEANUP_INTERVAL', 3600000),
    },
    claude: {
      timeout: getEnvVarInt('CLAUDE_TIMEOUT', 300000),
      defaultMode: (getEnvVar('CLAUDE_DEFAULT_MODE', 'default') as 'default' | 'auto'),
      cardUpdateInterval: getEnvVarInt('CLAUDE_CARD_UPDATE_INTERVAL', 500),
      permissionTimeout: getEnvVarInt('CLAUDE_PERMISSION_TIMEOUT', 300000),
    },
    opencode: {
      timeout: getEnvVarInt('OPENCODE_TIMEOUT', 300000),
      defaultMode: (getEnvVar('OPENCODE_DEFAULT_MODE', 'default') as 'default' | 'auto'),
      cardUpdateInterval: getEnvVarInt('OPENCODE_CARD_UPDATE_INTERVAL', 500),
      permissionTimeout: getEnvVarInt('OPENCODE_PERMISSION_TIMEOUT', 300000),
    },
    timing: {
      shellCaptureDelay: getEnvVarInt('TIMING_SHELL_CAPTURE_DELAY', 1500),
      rawModeCaptureDelay: getEnvVarInt('TIMING_RAW_CAPTURE_DELAY', 400),
      claudeStartupWait: getEnvVarInt('TIMING_CLAUDE_STARTUP_WAIT', 3000),
      claudePollInterval: getEnvVarInt('TIMING_CLAUDE_POLL_INTERVAL', 1000),
      claudeFirstPollDelay: getEnvVarInt('TIMING_CLAUDE_FIRST_POLL_DELAY', 1500),
      claudeMenuPollDelay: getEnvVarInt('TIMING_CLAUDE_MENU_POLL_DELAY', 1000),
    },
    clouddev: {
      username: getEnvVar('CLOUDDEV_USERNAME', ''),
      imageType: getEnvVar('CLOUDDEV_IMAGE_TYPE', 'android'),
      relayHost: getEnvVar('CLOUDDEV_RELAY_HOST', 'relay.xiaomi.com'),
      emailPassword: getEnvVar('CLOUDDEV_EMAIL_PASSWORD', ''),
    },
    upload: {
      dir: getEnvVar('UPLOAD_DIR', path.join(os.homedir(), 'uploads')),
    },
  };
}

// Singleton config instance
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
