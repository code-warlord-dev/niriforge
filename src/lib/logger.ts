/**
 * Frontend logger with configurable levels and localStorage persistence.
 * No-op when disabled (except error level which always logs).
 */

type Level = "trace" | "debug" | "info" | "warn" | "error";

interface LoggerConfig {
  enabled: boolean;
  level: Level;
}

const STORAGE_KEY = "niriforge.logging";

let config: LoggerConfig = { enabled: false, level: "info" };

const LEVELS: Level[] = ["trace", "debug", "info", "warn", "error"];

function shouldLog(level: Level): boolean {
  if (!config.enabled) return false;
  return LEVELS.indexOf(level) >= LEVELS.indexOf(config.level);
}

function formatArgs(scope: string, msg: string, data?: unknown): unknown[] {
  const prefix = `[${scope}]`;
  return data !== undefined ? [prefix, msg, data] : [prefix, msg];
}

function readFromStorage(): LoggerConfig | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (
        typeof parsed.enabled === "boolean" &&
        LEVELS.includes(parsed.level)
      ) {
        return { enabled: parsed.enabled, level: parsed.level };
      }
    }
  } catch {
    // Ignore parse errors, fall back to defaults
  }
  return null;
}

export const logger = {
  /**
   * Configure the logger.
   * @param opts - Partial config to merge with current config.
   */
  configure(opts: Partial<LoggerConfig>) {
    config = { ...config, ...opts };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore storage errors
    }
  },

  /**
   * Get current config.
   */
  getConfig(): LoggerConfig {
    return { ...config };
  },

  /**
   * Initialize logger from localStorage.
   * Call once at app startup.
   */
  init() {
    const stored = readFromStorage();
    if (stored) {
      config = stored;
    }
    // Also check for env-like override (e.g., from Vite define or query param)
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const debugParam = urlParams.get("debug");
      if (debugParam === "true" || debugParam === "1") {
        config.enabled = true;
        config.level = "debug";
      }
    }
  },

  trace(scope: string, msg: string, data?: unknown) {
    if (shouldLog("trace")) console.debug(...formatArgs(scope, msg, data));
  },

  debug(scope: string, msg: string, data?: unknown) {
    if (shouldLog("debug")) console.debug(...formatArgs(scope, msg, data));
  },

  info(scope: string, msg: string, data?: unknown) {
    if (shouldLog("info")) console.info(...formatArgs(scope, msg, data));
  },

  warn(scope: string, msg: string, data?: unknown) {
    if (shouldLog("warn")) console.warn(...formatArgs(scope, msg, data));
  },

  /**
   * Error always logs regardless of enabled/level setting.
   */
  error(scope: string, msg: string, data?: unknown) {
    console.error(...formatArgs(scope, msg, data));
  },
};

// Auto-initialize on module load
logger.init();