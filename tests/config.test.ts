import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getConfig, resetConfig } from '../src/config';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset config singleton
    resetConfig();
    // Clone environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load config from environment variables', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      process.env.ALLOWED_USERS = 'user1,user2';
      process.env.PORT = '8080';
      process.env.TERMINAL_COLS = '60';
      process.env.TERMINAL_ROWS = '30';

      const config = loadConfig();

      expect(config.feishu.appId).toBe('test_app_id');
      expect(config.feishu.appSecret).toBe('test_app_secret');
      expect(config.security.allowedUsers).toEqual(['user1', 'user2']);
      expect(config.server.port).toBe(8080);
      expect(config.terminal.cols).toBe(60);
      expect(config.terminal.rows).toBe(30);
    });

    it('should use default values for optional env vars', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      // Explicitly delete optional env vars to test defaults
      delete process.env.PORT;
      delete process.env.HOST;
      delete process.env.TERMINAL_COLS;
      delete process.env.TERMINAL_ROWS;
      delete process.env.TERMINAL_HISTORY_LIMIT;
      delete process.env.SHELL;
      delete process.env.SESSION_PREFIX;
      delete process.env.DATA_DIR;
      delete process.env.CLAUDE_TIMEOUT;
      delete process.env.CLAUDE_DEFAULT_MODE;
      delete process.env.CLAUDE_CARD_UPDATE_INTERVAL;
      delete process.env.TIMING_SHELL_CAPTURE_DELAY;
      delete process.env.TIMING_RAW_CAPTURE_DELAY;
      delete process.env.TIMING_CLAUDE_STARTUP_WAIT;
      delete process.env.TIMING_CLAUDE_POLL_INTERVAL;
      delete process.env.TIMING_CLAUDE_FIRST_POLL_DELAY;
      delete process.env.TIMING_CLAUDE_MENU_POLL_DELAY;

      const config = loadConfig();

      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.terminal.cols).toBe(80);
      expect(config.terminal.rows).toBe(24);
      expect(config.terminal.shell).toBe('/bin/bash');
      expect(config.terminal.historyLimit).toBe(50000);
      expect(config.session.prefix).toBe('remote-cli');
      expect(config.claude.timeout).toBe(300000);
      expect(config.claude.defaultMode).toBe('default');
      expect(config.claude.cardUpdateInterval).toBe(500);
      expect(config.timing.shellCaptureDelay).toBe(1500);
      expect(config.timing.rawModeCaptureDelay).toBe(400);
      expect(config.timing.claudeStartupWait).toBe(3000);
      expect(config.timing.claudePollInterval).toBe(1000);
      expect(config.timing.claudeFirstPollDelay).toBe(1500);
      expect(config.timing.claudeMenuPollDelay).toBe(1000);
    });

    it('should throw error for missing required env vars', () => {
      delete process.env.FEISHU_APP_ID;
      delete process.env.FEISHU_APP_SECRET;

      expect(() => loadConfig()).toThrow('Missing required environment variable');
    });

    it('should handle empty ALLOWED_USERS', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      delete process.env.ALLOWED_USERS;

      const config = loadConfig();

      expect(config.security.allowedUsers).toEqual([]);
    });

    it('should handle whitespace in ALLOWED_USERS', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      process.env.ALLOWED_USERS = ' user1 , user2 , user3 ';

      const config = loadConfig();

      expect(config.security.allowedUsers).toEqual(['user1', 'user2', 'user3']);
    });

    it('should load timing config from environment variables', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      process.env.TIMING_SHELL_CAPTURE_DELAY = '2000';
      process.env.TIMING_RAW_CAPTURE_DELAY = '600';
      process.env.TIMING_CLAUDE_STARTUP_WAIT = '5000';
      process.env.TIMING_CLAUDE_POLL_INTERVAL = '2000';
      process.env.TIMING_CLAUDE_FIRST_POLL_DELAY = '3000';
      process.env.TIMING_CLAUDE_MENU_POLL_DELAY = '1500';
      process.env.TERMINAL_HISTORY_LIMIT = '100000';

      const config = loadConfig();

      expect(config.timing.shellCaptureDelay).toBe(2000);
      expect(config.timing.rawModeCaptureDelay).toBe(600);
      expect(config.timing.claudeStartupWait).toBe(5000);
      expect(config.timing.claudePollInterval).toBe(2000);
      expect(config.timing.claudeFirstPollDelay).toBe(3000);
      expect(config.timing.claudeMenuPollDelay).toBe(1500);
      expect(config.terminal.historyLimit).toBe(100000);
    });

    it('should throw error for invalid PORT', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';
      process.env.PORT = 'not_a_number';

      expect(() => loadConfig()).toThrow('must be a valid integer');
    });
  });

  describe('getConfig', () => {
    it('should return singleton config instance', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';

      const config1 = getConfig();
      const config2 = getConfig();

      expect(config1).toBe(config2);
    });

    it('should return new instance after reset', () => {
      process.env.FEISHU_APP_ID = 'test_app_id';
      process.env.FEISHU_APP_SECRET = 'test_app_secret';

      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();

      expect(config1).not.toBe(config2);
    });
  });
});
