'use strict';

const config = require('../config/config');
const logger = require('../config/logger');

/**
 * Middleware: Validasi API Key dari request header X-API-Key
 */
const requireApiKey = (req, res, next) => {
  // Skip auth untuk endpoint publik (misal status/sessions polling dan dashboard UI)
  // NOTE: Middleware dipasang di app.use('/api', ...) jadi req.path sudah di-strip prefix /api
  const publicPaths = ['/qr', '/status', '/sessions', '/dashboard'];
  if (publicPaths.some(p => req.path.startsWith(p))) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    logger.warn(`[Auth] Missing API Key from ${req.ip} → ${req.method} ${req.path}`);
    return res.status(401).json({
      success: false,
      error: 'API Key required. Include X-API-Key header.',
    });
  }

  if (apiKey !== config.API_KEY) {
    logger.warn(`[Auth] Invalid API Key from ${req.ip} → ${req.method} ${req.path}`);
    return res.status(403).json({
      success: false,
      error: 'Invalid API Key.',
    });
  }

  next();
};

module.exports = { requireApiKey };
