'use strict';

const { getStatus, getAllStatuses, getQR, connectSession, logoutSession } = require('../services/whatsappService');
const QRCode = require('qrcode');
const logger = require('../config/logger');

/**
 * GET /api/status?session=bot
 */
const getConnectionStatus = (req, res) => {
  const session = req.query.session || 'bot';
  const status = getStatus(session);
  res.json({ success: true, data: status });
};

/**
 * GET /api/sessions
 * List status semua session (bot & am)
 */
const getAllSessions = (req, res) => {
  const statuses = getAllStatuses();
  res.json({ success: true, data: statuses });
};

/**
 * POST /api/sessions/:session/connect
 * Trigger koneksi manual (on-demand)
 */
const triggerConnectSession = async (req, res) => {
  const session = req.params.session || 'bot';
  try {
    connectSession(session); // async launch
    res.json({ success: true, message: `Connecting session "${session}"...`, status: getStatus(session) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/sessions/:session/logout
 * Logout dan reset session
 */
const triggerLogoutSession = async (req, res) => {
  const session = req.params.session || 'bot';
  try {
    await logoutSession(session);
    res.json({ success: true, message: `Session "${session}" logged out successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/qr?session=bot
 */
const getQRPage = async (req, res) => {
  const session = req.query.session || 'bot';
  const status = getStatus(session);

  // Jika status disconnected, trigger connectSession secara on-demand saat halaman diakses
  if (status.status === 'disconnected') {
    logger.info(`[QR Page] User requested QR for session "${session}". Triggering connectSession...`);
    connectSession(session);
  }

  const qr = getQR(session);

  if (status.status === 'connected') {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WA Status — Session: ${session.toUpperCase()}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 48px; text-align: center; max-width: 420px; }
          .icon { font-size: 64px; margin-bottom: 16px; }
          h1 { color: #58a6ff; font-size: 1.5rem; margin-bottom: 8px; }
          p { color: #8b949e; margin-bottom: 24px; }
          .badge { display: inline-block; background: #1a7f37; color: #3fb950; padding: 6px 16px; border-radius: 99px; font-size: 0.875rem; font-weight: 600; }
          .phone { color: #58a6ff; font-size: 0.875rem; margin-top: 8px; }
          .nav { margin-top: 24px; font-size: 0.85rem; }
          .nav a { color: #58a6ff; text-decoration: none; margin: 0 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✅</div>
          <h1>Session "${session.toUpperCase()}" Connected</h1>
          <p>Koneksi WhatsApp aktif dan siap digunakan.</p>
          <span class="badge">● CONNECTED (${session})</span>
          <p class="phone">${status.name || ''} · ${status.phone || ''}</p>
          <div class="nav">
            Switch: 
            <a href="/api/qr?session=bot">Session Bot</a> | 
            <a href="/api/qr?session=am">Session AM</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  if (!qr) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="3">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WA Status — Session: ${session.toUpperCase()}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
          .card { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 48px; text-align: center; max-width: 420px; }
          .icon { font-size: 64px; margin-bottom: 16px; animation: spin 2s linear infinite; }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          h1 { color: #f0883e; font-size: 1.5rem; margin-bottom: 8px; }
          p { color: #8b949e; }
          .nav { margin-top: 24px; font-size: 0.85rem; }
          .nav a { color: #58a6ff; text-decoration: none; margin: 0 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">⚙️</div>
          <h1>Menghubungkan Session "${session}"...</h1>
          <p>Sedang membuat QR Code. Halaman ini auto-refresh setiap 3 detik.</p>
          <div class="nav">
            Switch: 
            <a href="/api/qr?session=bot">Session Bot</a> | 
            <a href="/api/qr?session=am">Session AM</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  let qrDataUrl;
  try {
    qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
  } catch (err) {
    logger.error('[QR] Failed to generate QR:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate QR code' });
  }

  return res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="30">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Scan QR — Session: ${session.toUpperCase()}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: #0d1117; color: #e6edf3; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 40px 48px; text-align: center; max-width: 440px; }
        .logo { font-size: 2rem; font-weight: 700; color: #58a6ff; margin-bottom: 4px; }
        .subtitle { color: #8b949e; font-size: 0.875rem; margin-bottom: 24px; }
        .qr-wrapper { background: #fff; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 24px; }
        img { display: block; }
        h1 { font-size: 1.25rem; margin-bottom: 8px; }
        .steps { text-align: left; background: #0d1117; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
        .steps li { color: #8b949e; font-size: 0.875rem; margin-bottom: 6px; padding-left: 4px; }
        .steps li::before { content: "→ "; color: #58a6ff; }
        .refresh-note { font-size: 0.75rem; color: #6e7681; }
        .badge { display: inline-block; background: #1a3a5c; color: #58a6ff; padding: 4px 12px; border-radius: 99px; font-size: 0.75rem; margin-bottom: 20px; }
        .nav { margin-top: 16px; font-size: 0.85rem; border-top: 1px solid #30363d; padding-top: 16px; }
        .nav a { color: #58a6ff; text-decoration: none; margin: 0 8px; font-weight: 600; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">AM Hub WA API</div>
        <div class="subtitle">Session Target: <strong style="color:#58a6ff">${session.toUpperCase()}</strong></div>
        <span class="badge">● SCAN QR UNTUK SESSION "${session}"</span>
        <div class="qr-wrapper">
          <img src="${qrDataUrl}" width="280" height="280" alt="WhatsApp QR Code">
        </div>
        <h1>Scan QR Code</h1>
        <div class="steps">
          <ol>
            <li>Buka WhatsApp di HP (${session === 'bot' ? 'Nomor Bot Notifikasi' : 'Nomor AM Personal'})</li>
            <li>Tap menu (···) → Perangkat Tertaut</li>
            <li>Tap "Tautkan Perangkat"</li>
            <li>Arahkan kamera ke QR ini</li>
          </ol>
        </div>
        <p class="refresh-note">QR auto-refresh setiap 30 detik</p>
        <div class="nav">
          Pilih Session: 
          <a href="/api/qr?session=bot">Bot Notifikasi</a> | 
          <a href="/api/qr?session=am">AM Personal</a>
        </div>
      </div>
    </body>
    </html>
  `);
};

/**
 * GET /api/qr-json?session=bot
 * Return JSON status & DataURL QR Code untuk UI Modal Dashboard
 */
const getQRJson = async (req, res) => {
  const session = req.query.session || 'bot';
  const status = getStatus(session);

  // Jika status disconnected, picu connectSession secara otomatis (on-demand)
  if (status.status === 'disconnected') {
    logger.info(`[QR JSON] User requested QR for session "${session}". Triggering connectSession...`);
    connectSession(session);
  }

  const qr = getQR(session);

  let qrDataUrl = null;
  if (qr) {
    try {
      qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    } catch (err) {
      logger.error(`[QR JSON] Failed to convert QR to DataURL: ${err.message}`);
    }
  }

  res.json({
    success: true,
    session,
    status: status.status,
    hasQR: !!qr,
    qrDataUrl,
    phone: status.phone,
    name: status.name,
  });
};

module.exports = { getConnectionStatus, getAllSessions, getQRPage, getQRJson, triggerConnectSession, triggerLogoutSession };


