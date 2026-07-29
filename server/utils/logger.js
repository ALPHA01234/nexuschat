/* Minimal structured logger. Swappable for winston/pino later without
   touching call sites — everything goes through this module. */

function ts() {
  return new Date().toISOString();
}

const logger = {
  info: (...args) => console.log(`[${ts()}] INFO `, ...args),
  warn: (...args) => console.warn(`[${ts()}] WARN `, ...args),
  error: (...args) => console.error(`[${ts()}] ERROR`, ...args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') console.log(`[${ts()}] DEBUG`, ...args);
  },
};

module.exports = logger;
