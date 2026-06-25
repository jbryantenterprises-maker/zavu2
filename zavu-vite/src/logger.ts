const debugEnabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG_LOGS === 'true';

// Validate that debug logs environment variable is properly set if used
if (import.meta.env.VITE_DEBUG_LOGS !== undefined && import.meta.env.VITE_DEBUG_LOGS !== 'true' && import.meta.env.VITE_DEBUG_LOGS !== 'false') {
  console.warn('VITE_DEBUG_LOGS should be either "true" or "false", got:', import.meta.env.VITE_DEBUG_LOGS);
}

export const Logger = {
  debug(message: string, ...details: unknown[]) {
    if (debugEnabled) {
      console.debug(message, ...details);
    }
  },

  warn(message: string, ...details: unknown[]) {
    if (debugEnabled) {
      console.warn(message, ...details);
    }
  },

  error(message: string, ...details: unknown[]) {
    if (debugEnabled) {
      console.error(message, ...details);
    }
  },
};
