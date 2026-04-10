import type { AISessionDriver } from './types';

export interface MenuOption {
  label: string;
  index: number;
  selected: boolean;
}

export interface DetectedMenu {
  title: string;
  options: MenuOption[];
  hint: string;
}

export interface AIMetadata {
  backend?: string;   // 'claude' | 'opencode'
  model?: string;
  cwd?: string;
  context?: string;
  status?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AIManagerCallbacks {
  onStreamStart: (conversationId: string) => Promise<string | undefined>;
  onStreamUpdate: (conversationId: string, messageId: string, content: string, metadata?: AIMetadata) => void;
  onStreamEnd: (conversationId: string, messageId: string, content: string, metadata: AIMetadata) => void;
  onMenu: (conversationId: string, menu: DetectedMenu) => void;
  onError: (conversationId: string, error: string) => void;
}

/**
 * AI Manager — thin orchestrator that delegates to an AISessionDriver.
 * Preserves the same public API for the handler layer.
 */
export class AIManager {
  private driver: AISessionDriver;
  private callbacks: AIManagerCallbacks;

  constructor(callbacks: AIManagerCallbacks, driver: AISessionDriver) {
    this.callbacks = callbacks;
    this.driver = driver;
  }

  async startSession(conversationId: string, _sessionName: string, cwd?: string): Promise<void> {
    await this.driver.start(conversationId, { cwd });
  }

  async sendMessage(conversationId: string, message: string): Promise<void> {
    await this.driver.sendMessage(conversationId, message);
  }

  async selectMenuOption(conversationId: string, targetIndex: number): Promise<void> {
    await this.driver.selectMenuOption(conversationId, targetIndex);
  }

  async interruptSession(conversationId: string): Promise<void> {
    await this.driver.interrupt(conversationId);
  }

  isSessionActive(conversationId: string): boolean {
    return this.driver.hasSession(conversationId);
  }

  async isSessionAlive(conversationId: string): Promise<boolean> {
    return this.driver.isAlive(conversationId);
  }

  async killSession(conversationId: string): Promise<void> {
    await this.driver.kill(conversationId);
  }

  async reconnectSession(conversationId: string, sessionId: string): Promise<boolean> {
    return this.driver.reconnect(conversationId, sessionId);
  }

  async killAll(): Promise<void> {
    await this.driver.killAll();
  }

  /** Get the SDK session ID for persistence */
  getSessionId(conversationId: string): string | undefined {
    return this.driver.getSessionId(conversationId);
  }
}
