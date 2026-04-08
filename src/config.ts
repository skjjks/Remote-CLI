import dotenv from 'dotenv';
import path from 'path';

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
  };
  session: {
    prefix: string;
    dataDir: string;
  };
  claude: {
    timeout: number;
    defaultMode: 'default' | 'auto';
    cardUpdateInterval: number;
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
      cols: getEnvVarInt('TERMINAL_COLS', 80),
      rows: getEnvVarInt('TERMINAL_ROWS', 24),
      shell: getEnvVar('SHELL', '/bin/bash'),
    },
    session: {
      prefix: getEnvVar('SESSION_PREFIX', 'remote-cli'),
      dataDir: getEnvVar('DATA_DIR', path.join(process.cwd(), 'data')),
    },
    claude: {
      timeout: getEnvVarInt('CLAUDE_TIMEOUT', 300000),
      defaultMode: (getEnvVar('CLAUDE_DEFAULT_MODE', 'default') as 'default' | 'auto'),
      cardUpdateInterval: getEnvVarInt('CLAUDE_CARD_UPDATE_INTERVAL', 500),
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
