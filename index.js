'use strict';

require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config/config');
const logger = require('./src/config/logger');
const { connectAll, onMessage } = require('./src/services/whatsappService');
const { loadSchedules } = require('./src/services/schedulerService');
const { handleInboundMessage } = require('./src/services/chatbotService');

const start = async () => {
  logger.info('');
  logger.info('╔══════════════════════════════════════════╗');
  logger.info('║     WA API — AM Hub (Multi-Session)      ║');
  logger.info('╚══════════════════════════════════════════╝');
  logger.info('');

  const server = app.listen(config.PORT, () => {
    logger.info(`[Server] ✅ HTTP Server running on port ${config.PORT}`);
    logger.info(`[Server] 📱 Sessions status: http://localhost:${config.PORT}/api/sessions`);
    logger.info(`[Server] 📱 QR Bot Page:      http://localhost:${config.PORT}/api/qr?session=bot`);
    logger.info(`[Server] 📱 QR AM Page:       http://localhost:${config.PORT}/api/qr?session=am`);
    logger.info(`[Server] ❤️  Health:         http://localhost:${config.PORT}/health`);
  });

  onMessage(handleInboundMessage);

  try {
    await connectAll();
  } catch (err) {
    logger.error(`[WA] Initial connections failed: ${err.message}`);
  }

  try {
    loadSchedules();
  } catch (err) {
    logger.error(`[Scheduler] Failed to load schedules: ${err.message}`);
  }

  const shutdown = (signal) => {
    logger.info(`\n[Server] ${signal} received. Shutting down gracefully...`);
    server.close(() => {
      logger.info('[Server] HTTP server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error(`[Process] Unhandled rejection: ${reason}`);
  });
};

start();
