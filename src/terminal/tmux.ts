import { spawn, SpawnOptions } from 'child_process';

/**
 * Execute a tmux command and return the result
 */
function executeTmux(args: string[], options?: SpawnOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const defaultOptions: SpawnOptions = {
      env: { ...process.env },
    };

    const spawnOptions = { ...defaultOptions, ...options };
    const tmux = spawn('tmux', args, spawnOptions);

    let stdout = '';
    let stderr = '';

    tmux.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    tmux.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    tmux.on('error', (error) => {
      reject(new Error(`Failed to execute tmux: ${error.message}`));
    });

    tmux.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const errorMsg = stderr.trim() || `tmux exited with code ${code}`;
        reject(new Error(`tmux ${args.join(' ')} failed: ${errorMsg}`));
      }
    });
  });
}

/**
 * Create a new tmux session with specified parameters
 * @param name - Session name
 * @param shell - Shell to use (e.g., /bin/bash)
 * @param cols - Terminal width in columns
 * @param rows - Terminal height in rows
 */
export async function createSession(
  name: string,
  shell: string,
  cols: number,
  rows: number
): Promise<void> {
  const args = [
    'new-session',
    '-d',           // Detached mode
    '-s', name,     // Session name
    '-x', cols.toString(),
    '-y', rows.toString(),
    shell           // Shell to run
  ];

  await executeTmux(args, {
    env: { ...process.env, TERM: 'xterm-256color' }
  });

  // Set large scrollback buffer so capture-pane -S - gets full history
  await executeTmux(['set-option', '-t', name, 'history-limit', '50000']);
}

/**
 * Attach to an existing tmux session (for manual use)
 * @param name - Session name to attach to
 */
export async function attachSession(name: string): Promise<void> {
  const args = ['attach-session', '-t', name];
  await executeTmux(args);
}

/**
 * Kill a tmux session
 * @param name - Session name to kill
 */
export async function killSession(name: string): Promise<void> {
  const args = ['kill-session', '-t', name];
  await executeTmux(args);
}

/**
 * List all tmux session names
 * @returns Array of session names
 */
export async function listSessions(): Promise<string[]> {
  const args = ['list-sessions', '-F', '#{session_name}'];

  try {
    const output = await executeTmux(args);
    if (!output) {
      return [];
    }
    return output.split('\n').filter(name => name.length > 0);
  } catch (error) {
    // No sessions exist or tmux server not running
    if (error instanceof Error && (
      error.message.includes('no server running') ||
      error.message.includes('error connecting to') ||
      error.message.includes('No such file or directory')
    )) {
      return [];
    }
    throw error;
  }
}

/**
 * Check if a tmux session exists
 * @param name - Session name to check
 * @returns true if session exists
 */
export async function sessionExists(name: string): Promise<boolean> {
  const args = ['has-session', '-t', name];

  try {
    await executeTmux(args);
    return true;
  } catch (err) {
    console.warn('[TMUX] has-session check failed for', name + ':', err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Send keystrokes to a tmux session
 * @param name - Session name
 * @param keys - Keys to send (can include special keys like Enter)
 */
export async function sendKeys(name: string, keys: string): Promise<void> {
  const args = ['send-keys', '-t', name, keys];
  await executeTmux(args);
}

/**
 * Get the current foreground command running in a tmux pane
 * @param name - Session name
 * @returns The process name (e.g., 'bash', 'vim', 'htop')
 */
export async function getCurrentCommand(name: string): Promise<string> {
  return executeTmux([
    'display-message', '-p', '-t', name,
    '#{pane_current_command}'
  ]);
}

/**
 * Capture the current pane output from a tmux session
 * @param name - Session name
 * @returns Captured pane content as string
 */
export async function capturePane(name: string): Promise<string> {
  // -p: print to stdout
  // -S -: start from beginning of scrollback buffer (capture full history)
  // -E -: end at last line
  const args = ['capture-pane', '-t', name, '-p', '-S', '-', '-E', '-'];
  return executeTmux(args);
}
