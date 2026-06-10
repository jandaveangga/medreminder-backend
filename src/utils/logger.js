/**
 * Simple structured logger with timestamps and levels
 */
const logger = {
  _format(level, message, data) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}]`;
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  },

  info(message, data) {
    this._format('INFO', message, data);
  },

  warn(message, data) {
    this._format('WARN', `⚠️  ${message}`, data);
  },

  error(message, data) {
    this._format('ERROR', `❌ ${message}`, data);
  },

  debug(message, data) {
    if (process.env.NODE_ENV !== 'production') {
      this._format('DEBUG', message, data);
    }
  },

  success(message, data) {
    this._format('INFO', `✅ ${message}`, data);
  },
};

module.exports = logger;
