import { getConfig } from '../config';
import * as tmux from '../terminal/tmux';
import { extractAuthInfo } from './qr-extract';

export type ConnectorState =
  | 'init'
  | 'ssh_sent'
  | 'auth_waiting'
  | 'sync_sent'
  | 'domain_sent'
  | 'connected'
  | 'failed';

export interface ConnectorCallbacks {
  onStateChange: (state: ConnectorState, message: string) => void;
  onAuthRequired: (type: 'qrcode' | 'password', url?: string, screenshot?: string) => void;
  onScreenUpdate: (state: ConnectorState, screenshot: string) => void;
  onConnected: () => void;
  onFailed: (error: string) => void;
}

interface ConnectorOptions {
  username?: string;
  emailPassword?: string;
  pollIntervalMs?: number;
  authTimeoutMs?: number;
  stepTimeoutMs?: number;
}

const POLL_INTERVAL = 1000;
const AUTH_TIMEOUT = 600_000;   // 10 minutes for scanning
const STEP_TIMEOUT = 60_000;   // 60 seconds for non-auth steps

export class CloudDevConnector {
  private tmuxName: string;
  private callbacks: ConnectorCallbacks;
  private state: ConnectorState = 'init';
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stateEnteredAt: number = Date.now();
  private authSent = false;

  private username: string;
  private imageType: string;
  private relayHost: string;
  private emailPassword: string;
  private pollIntervalMs: number;
  private authTimeoutMs: number;
  private stepTimeoutMs: number;

  constructor(tmuxName: string, callbacks: ConnectorCallbacks, options?: ConnectorOptions) {
    this.tmuxName = tmuxName;
    this.callbacks = callbacks;

    const config = getConfig();
    this.username = options?.username || config.clouddev.username;
    this.imageType = config.clouddev.imageType;
    this.relayHost = config.clouddev.relayHost;
    this.emailPassword = options?.emailPassword ?? config.clouddev.emailPassword;
    this.pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL;
    this.authTimeoutMs = options?.authTimeoutMs ?? AUTH_TIMEOUT;
    this.stepTimeoutMs = options?.stepTimeoutMs ?? STEP_TIMEOUT;
  }

  getState(): ConnectorState {
    return this.state;
  }

  private setState(newState: ConnectorState, message: string): void {
    this.state = newState;
    this.stateEnteredAt = Date.now();
    this.callbacks.onStateChange(newState, message);
  }

  async start(): Promise<void> {
    const sshCmd = `ssh ${this.username}@${this.relayHost}`;
    await tmux.sendLiteralKeys(this.tmuxName, sshCmd);
    await tmux.sendKeys(this.tmuxName, 'Enter');
    this.setState('ssh_sent', `SSH connecting to ${this.relayHost}...`);
  }

  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.poll().catch(err => {
        console.error('[CLOUDDEV] Poll error:', err);
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async poll(): Promise<void> {
    if (this.state === 'connected' || this.state === 'failed') return;

    const captured = await tmux.capturePane(this.tmuxName);

    const elapsed = Date.now() - this.stateEnteredAt;
    const timeout = this.state === 'auth_waiting' ? this.authTimeoutMs : this.stepTimeoutMs;
    if (elapsed > timeout) {
      this.stop();
      this.setState('failed', `Timeout in state ${this.state} after ${Math.round(elapsed / 1000)}s`);
      this.callbacks.onFailed(`Connection timed out in state: ${this.state}`);
      return;
    }

    // Use last N lines for state detection — capturePane returns full scrollback
    // which still contains old auth prompts even after auth succeeds.
    const tail = this.tailLines(captured, 15);

    // Send screen update on every poll so the user sees real-time terminal output
    this.callbacks.onScreenUpdate(this.state, tail);

    switch (this.state) {
      case 'ssh_sent':
        await this.handleSshSent(captured);
        break;
      case 'auth_waiting':
        await this.handleAuthWaiting(tail);
        break;
      case 'sync_sent':
        await this.handleSyncSent(tail);
        break;
      case 'domain_sent':
        await this.handleDomainSent(tail);
        break;
    }
  }

  private async handleSshSent(captured: string): Promise<void> {
    const authInfo = extractAuthInfo(captured);
    if (!authInfo) return;

    this.setState('auth_waiting', 'Authentication required');

    if (authInfo.type === 'qrcode') {
      this.callbacks.onAuthRequired('qrcode', authInfo.url, captured);
    } else if (authInfo.type === 'password') {
      this.callbacks.onAuthRequired('password', undefined, captured);
      if (this.emailPassword && !this.authSent) {
        this.authSent = true;
        await tmux.sendLiteralKeys(this.tmuxName, this.emailPassword);
        await tmux.sendKeys(this.tmuxName, 'Enter');
      }
    }
  }

  private async handleAuthWaiting(tail: string): Promise<void> {
    // Auth is done when a shell prompt appears at the end of the terminal.
    // We check the tail (last N lines) so old auth prompts still in
    // scrollback don't prevent detection.
    if (this.hasShellPrompt(tail)) {
      this.setState('sync_sent', 'Auth complete, sending sync...');
      await tmux.sendLiteralKeys(this.tmuxName, 'sync');
      await tmux.sendKeys(this.tmuxName, 'Enter');
    }
  }

  private async handleSyncSent(captured: string): Promise<void> {
    if (this.hasShellPrompt(captured) && this.textContains(captured, 'sync')) {
      const domain = `clouddev-${this.username}.${this.imageType}.xiaomi.com`;
      this.setState('domain_sent', `Sync done, connecting to ${domain}...`);
      await tmux.sendLiteralKeys(this.tmuxName, domain);
      await tmux.sendKeys(this.tmuxName, 'Enter');
    }
  }

  private async handleDomainSent(captured: string): Promise<void> {
    // Connected when: shell prompt visible AND the last prompt line
    // does NOT contain "relay" (relay prompts look like "hostname:user>",
    // cloud prompts look like "docker@:~$").
    // Check only the last line to avoid false negatives from "Relay-Share" URLs in scrollback.
    const lastLine = captured.trimEnd().split('\n').pop() || '';
    if (this.hasShellPrompt(captured) && !/relay/i.test(lastLine)) {
      this.stop();
      this.setState('connected', 'Connected to engineering cloud');
      this.callbacks.onConnected();
    }
  }

  /**
   * Get the last N non-empty lines from captured text.
   * Used to detect current terminal state without being confused by
   * old content still in the scrollback buffer.
   */
  private tailLines(text: string, n: number): string {
    const lines = text.split('\n');
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') end--;
    const start = Math.max(0, end - n + 1);
    return lines.slice(start, end + 1).join('\n');
  }

  private hasShellPrompt(text: string): boolean {
    // Match common prompts: $ # and relay-style "hostname:user>"
    return /[$#>]\s*$/.test(text.trimEnd());
  }

  private textContains(text: string, keyword: string): boolean {
    return text.toLowerCase().includes(keyword.toLowerCase());
  }
}
