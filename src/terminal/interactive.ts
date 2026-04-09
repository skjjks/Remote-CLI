/**
 * Known interactive terminal programs that need raw input mode.
 * When the tmux foreground process matches one of these, keystrokes
 * are sent without appending Enter.
 */
const INTERACTIVE_PROGRAMS = new Set([
  // Editors
  'vim', 'vi', 'nvim', 'nano', 'emacs',
  // Monitors
  'htop', 'top', 'btop',
  // Pagers
  'less', 'more', 'man',
  // REPLs
  'python', 'python3', 'node', 'irb',
  // Database clients
  'mysql', 'psql', 'redis-cli',
  // TUI tools
  'fzf', 'tig', 'lazygit',
]);

/**
 * Check if a process name is a known interactive program.
 */
export function isInteractiveProgram(processName: string): boolean {
  return INTERACTIVE_PROGRAMS.has(processName);
}

/**
 * Map of shortcut command names to tmux key names.
 * These are used as `!esc`, `!enter`, `!tab`, etc.
 */
const SHORTCUT_COMMANDS: Record<string, string> = {
  esc: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  'ctrl+c': 'C-c',
  'ctrl+d': 'C-d',
  'ctrl+z': 'C-z',
};

/**
 * Get the tmux key name for a shortcut command.
 * Returns undefined if the command is not a known shortcut.
 */
export function getShortcutKey(command: string): string | undefined {
  return SHORTCUT_COMMANDS[command.toLowerCase()];
}

export { SHORTCUT_COMMANDS };
