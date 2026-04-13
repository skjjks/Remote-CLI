import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CloudDevConnector, ConnectorCallbacks, ConnectorState } from '../src/clouddev/connector';

// Mock tmux module
vi.mock('../src/terminal/tmux', () => ({
  sendLiteralKeys: vi.fn().mockResolvedValue(undefined),
  sendKeys: vi.fn().mockResolvedValue(undefined),
  capturePane: vi.fn().mockResolvedValue(''),
}));

// Mock config
vi.mock('../src/config', () => ({
  getConfig: () => ({
    clouddev: {
      username: 'testuser',
      imageType: 'android',
      relayHost: 'relay.xiaomi.com',
      emailPassword: '',
    },
  }),
}));

import * as tmux from '../src/terminal/tmux';

function createMockCallbacks(): ConnectorCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onStateChange: vi.fn(),
    onAuthRequired: vi.fn(),
    onScreenUpdate: vi.fn(),
    onConnected: vi.fn(),
    onFailed: vi.fn(),
  };
}

describe('CloudDevConnector', () => {
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    callbacks = createMockCallbacks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends SSH command on start', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    await connector.start();

    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith(
      'test-tmux',
      'ssh testuser@relay.xiaomi.com',
    );
    expect(tmux.sendKeys).toHaveBeenCalledWith('test-tmux', 'Enter');
    expect(connector.getState()).toBe('ssh_sent');
  });

  it('detects QR code auth and extracts URL', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    await connector.start();

    vi.mocked(tmux.capturePane).mockResolvedValueOnce(`
Scan QR to authenticate:
https://auth.xiaomi.com/scan?token=abc123
█▀▀▀█ ████ █▀▀▀█
`);

    await connector.poll();

    expect(connector.getState()).toBe('auth_waiting');
    expect(callbacks.onAuthRequired).toHaveBeenCalledWith(
      'qrcode',
      'https://auth.xiaomi.com/scan?token=abc123',
      expect.any(String),
    );
  });

  it('detects password prompt and sends password if configured', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks, { emailPassword: 'mypassword' });
    await connector.start();

    vi.mocked(tmux.capturePane).mockResolvedValueOnce(
      "testuser@relay.xiaomi.com's password: "
    );

    await connector.poll();

    expect(connector.getState()).toBe('auth_waiting');
    expect(callbacks.onAuthRequired).toHaveBeenCalledWith('qrcode', undefined, expect.any(String));
    // Password auto-filled
    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith('test-tmux', 'mypassword');
    expect(tmux.sendKeys).toHaveBeenCalledWith('test-tmux', 'Enter');
  });

  it('transitions to sync_sent when shell prompt appears after auth', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    await connector.start();

    // First poll: auth screen
    vi.mocked(tmux.capturePane).mockResolvedValueOnce(
      'https://auth.xiaomi.com/scan?token=abc\n█▀▀▀█'
    );
    await connector.poll();
    expect(connector.getState()).toBe('auth_waiting');

    // Second poll: auth passed — full buffer still has old URL in scrollback,
    // but the LAST lines show the shell prompt (auth screen is gone)
    vi.mocked(tmux.capturePane).mockResolvedValueOnce(
      'https://auth.xiaomi.com/scan?token=abc\n█▀▀▀█\n\n\n\nWelcome to relay\ntestuser@relay:~$ '
    );
    await connector.poll();

    expect(connector.getState()).toBe('sync_sent');
    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith('test-tmux', 'sync');
  });

  it('sends domain after sync completes', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    connector['state'] = 'sync_sent' as ConnectorState;
    connector['stateEnteredAt'] = Date.now();

    vi.mocked(tmux.capturePane).mockResolvedValueOnce(
      'sync complete\ntestuser@relay:~$ '
    );
    await connector.poll();

    expect(connector.getState()).toBe('domain_sent');
    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith(
      'test-tmux',
      'clouddev-testuser.android.xiaomi.com',
    );
  });

  it('marks connected when cloud shell prompt appears', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    connector['state'] = 'domain_sent' as ConnectorState;
    connector['stateEnteredAt'] = Date.now();

    vi.mocked(tmux.capturePane).mockResolvedValueOnce(
      'testuser@clouddev:~$ '
    );
    await connector.poll();

    expect(connector.getState()).toBe('connected');
    expect(callbacks.onConnected).toHaveBeenCalled();
  });

  it('stop() clears the poll interval', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks);
    await connector.start();
    connector.startPolling();

    expect(connector['pollTimer']).not.toBeNull();
    connector.stop();
    expect(connector['pollTimer']).toBeNull();
  });

  it('uses custom username override', async () => {
    const connector = new CloudDevConnector('test-tmux', callbacks, { username: 'override' });
    await connector.start();

    expect(tmux.sendLiteralKeys).toHaveBeenCalledWith(
      'test-tmux',
      'ssh override@relay.xiaomi.com',
    );
  });
});
