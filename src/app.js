'use strict';

const express = require('express');
const cors = require('cors');
const { requireApiKey } = require('./middlewares/auth');
const logger = require('./config/logger');
const config = require('./config/config');

// Routes
const statusRoutes = require('./routes/statusRoutes');
const messageRoutes = require('./routes/messageRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: config.AMHUB_ORIGIN }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (skip frequent polling endpoints from noise)
const SILENT_POLLING_ROUTES = ['/api/sessions', '/api/logs/messages', '/api/logs/events', '/api/chatbot/rules', '/api/status', '/health'];

app.use((req, res, next) => {
  if (!SILENT_POLLING_ROUTES.includes(req.path)) {
    logger.info(`[HTTP] ${req.method} ${req.path}`);
  }
  next();
});

const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// ── Public Routes ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'wa-api-amhub', timestamp: new Date().toISOString() });
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// ── API Routes (Protected by API Key) ─────────────────────────────────────────
app.use('/api', requireApiKey, statusRoutes);
app.use('/api', requireApiKey, messageRoutes);
app.use('/api/webhook', requireApiKey, webhookRoutes);
app.use('/api', requireApiKey, adminRoutes);

// ── 404 Handler ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route "${req.method} ${req.path}" tidak ditemukan.` });
});

// ── Global Error Handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`[Express] Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

module.exports = app;
