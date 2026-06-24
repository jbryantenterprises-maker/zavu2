const debugEnabled = import.meta.env.DEV || import.meta.env.VITE_DEBUG_LOGS === 'true';

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
