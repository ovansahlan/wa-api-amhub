'use strict';

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../config/logger');
const { getDb } = require('../db/database');

// Map penampung multi-session: sessionId -> { sock, qrCode, connectionStatus, reconnectTimer }
const sessions = new Map();
const messageHandlers = [];

/**
 * Daftar session default yang di-support saat ini
 */
const DEFAULT_SESSIONS = ['bot', 'am'];

/**
 * Inisialisasi struktur internal session
 */
const getOrCreateSessionState = (sessionId) => {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      sock: null,
      qrCode: null,
      connectionStatus: 'disconnected',
      reconnectTimer: null,
    });
  }
  return sessions.get(sessionId);
};

/**
 * Register handler pesan masuk
 */
const onMessage = (handler) => {
  messageHandlers.push(handler);
};

/**
 * Get QR code per session
 */
const getQR = (sessionId = 'bot') => {
  const sess = sessions.get(sessionId);
  return sess ? sess.qrCode : null;
};

/**
 * Get status per session
 */
const getStatus = (sessionId = 'bot') => {
  const sess = sessions.get(sessionId);
  if (!sess) {
    return {
      session: sessionId,
      status: 'disconnected',
      hasQR: false,
      phone: null,
      name: null,
    };
  }
  return {
    session: sessionId,
    status: sess.connectionStatus,
    hasQR: !!sess.qrCode,
    phone: sess.sock?.user?.id || null,
    name: sess.sock?.user?.name || null,
  };
};

/**
 * Get status semua session
 */
const getAllStatuses = () => {
  return DEFAULT_SESSIONS.map((id) => getStatus(id));
};

/**
 * Format nomor telepon
 */
const formatPhone = (phone) => {
  const str = String(phone).trim();
  if (str.endsWith('@s.whatsapp.net') || str.endsWith('@lid') || str.endsWith('@g.us')) {
    return str;
  }
  if (str.includes('@lid')) {
    return str.endsWith('@lid') ? str : str + '@lid';
  }
  let cleaned = str.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }
  if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned;
  }
  return cleaned + '@s.whatsapp.net';
};

/**
 * Kirim pesan via session tertentu
 */
const sendMessage = async (phone, message, sessionId = 'bot') => {
  const sess = sessions.get(sessionId);
  if (!sess || sess.connectionStatus !== 'connected' || !sess.sock) {
    throw new Error(`WhatsApp session "${sessionId}" not connected. Please scan QR first.`);
  }

  const jid = formatPhone(phone);

  try {
    const sentMsg = await sess.sock.sendMessage(jid, { text: message });
    const messageId = sentMsg?.key?.id || null;
    logger.info(`[WA:${sessionId}] ✅ Sent to ${phone} (ID: ${messageId})`);
    return { success: true, session: sessionId, phone, jid, messageId };
  } catch (err) {
    logger.error(`[WA:${sessionId}] ❌ Failed to send to ${phone}: ${err.message}`);
    throw err;
  }
};

/**
 * Cek apakah session memiliki kredensial login tersimpan yang valid (sudah pernah scan QR & terotentikasi)
 */
const hasSessionCreds = (sessionId) => {
  const sessionPath = path.resolve(config.WA_SESSION_PATH, sessionId);
  const credsPath = path.join(sessionPath, 'creds.json');
  if (!fs.existsSync(credsPath)) return false;
  try {
    const raw = fs.readFileSync(credsPath, 'utf-8');
    const data = JSON.parse(raw);
    return !!(data && data.me && data.me.id);
  } catch (_) {
    return false;
  }
};

/**
 * Connect ke WhatsApp untuk sessionId tertentu
 */
const connectSession = async (sessionId) => {
  const sess = getOrCreateSessionState(sessionId);

  // Jika sudah terhubung, tidak perlu re-connect
  if (sess.connectionStatus === 'connected' && sess.sock) {
    logger.info(`[WA:${sessionId}] Already connected.`);
    return sess;
  }

  // Jika sedang proses connecting, tunggu sampai selesai
  if (sess.connectionStatus === 'connecting') {
    logger.info(`[WA:${sessionId}] Connection already in progress...`);
    return sess;
  }

  // Bersihkan socket lama jika ada dan belum connected
  if (sess.sock && sess.connectionStatus !== 'connected') {
    try {
      sess.sock.end(undefined);
    } catch (_) {}
    sess.sock = null;
  }

  sess.connectionStatus = 'connecting';
  sess.qrCode = null;

  logger.info(`[WA:${sessionId}] Initializing connection...`);

  const sessionPath = path.resolve(config.WA_SESSION_PATH, sessionId);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const pinoLogger = {
    level: 'silent',
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    child: () => pinoLogger,
  };

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
    },
    printQRInTerminal: true,
    logger: pinoLogger,
    browser: [`AM Hub (${sessionId})`, 'Chrome', '126.0'],
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
  });

  sess.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sess.qrCode = qr;
      sess.connectionStatus = 'qr';
      logger.info(`[WA:${sessionId}] 📱 QR Code generated. Please scan via /api/qr?session=${sessionId}`);
    }

    if (connection === 'close') {
      sess.qrCode = null;
      if (sess.reconnectTimer) {
        clearTimeout(sess.reconnectTimer);
        sess.reconnectTimer = null;
      }

      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

      logger.warn(`[WA:${sessionId}] Connection closed. Status: ${statusCode}, LoggedOut: ${isLoggedOut}, RestartRequired: ${isRestartRequired}`);

      if (isLoggedOut) {
        sess.connectionStatus = 'disconnected';
        sess.sock = null;
        logger.warn(`[WA:${sessionId}] ⚠️ Session logged out. Cleaning up session folder...`);
        try {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        } catch (_) {}
      } else if (isRestartRequired) {
        // Sinyal 515 dikirim WhatsApp saat QR selesai di-scan untuk memicu handshake akhir login
        sess.connectionStatus = 'disconnected';
        sess.sock = null;
        logger.info(`[WA:${sessionId}] 🔄 Restart required after QR scan. Finalizing login handshake...`);
        setTimeout(() => connectSession(sessionId), 500);
      } else if (hasSessionCreds(sessionId)) {
        // Sesi terdaftar yang terputus jaringan/restart -> auto reconnect
        sess.connectionStatus = 'disconnected';
        sess.reconnectTimer = setTimeout(() => {
          logger.info(`[WA:${sessionId}] 🔄 Reconnecting active session...`);
          connectSession(sessionId);
        }, config.WA_RECONNECT_INTERVAL);
      } else {
        // Sesi belum login dan QR timeout/closed -> Biarkan disconnected tanpa hapus folder
        sess.connectionStatus = 'disconnected';
        sess.sock = null;
        logger.info(`[WA:${sessionId}] QR code expired/closed. Waiting for user request to generate QR.`);
      }
    }

    if (connection === 'open') {
      sess.connectionStatus = 'connected';
      sess.qrCode = null;
      if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
      logger.info(`[WA:${sessionId}] ✅ Connected as: ${sock.user?.name} (${sock.user?.id})`);
    }
  });

  // Handler update status pesan (Delivered / Read)
  sock.ev.on('messages.update', async (updates) => {
    const db = getDb();
    for (const update of updates) {
      const msgId = update.key?.id || update.key;
      const rawStatus = update.update?.status !== undefined ? update.update.status : update.status;
      if (!msgId || rawStatus === undefined || rawStatus === null) continue;

      let receiptStatus = null;
      const statusNum = Number(rawStatus);

      // Status enum Baileys / WhatsApp:
      // 2 / 'SERVER_ACK' = sent (centang 1)
      // 3 / 'DELIVERY_ACK' = delivered (centang 2 abu-abu)
      // 4 / 'READ' / 'PLAYED' = read (centang 2 biru)
      if (statusNum === 3 || rawStatus === 'DELIVERY_ACK' || rawStatus === 'DELIVERED') {
        receiptStatus = 'delivered';
      } else if (statusNum === 4 || statusNum === 5 || rawStatus === 'READ' || rawStatus === 'PLAYED') {
        receiptStatus = 'read';
      }

      if (receiptStatus) {
        try {
          const res = db.prepare(`UPDATE message_logs SET receipt_status = ?, updated_at = CURRENT_TIMESTAMP WHERE message_id = ?`).run(receiptStatus, msgId);
          if (res.changes > 0) {
            logger.info(`[WA:${sessionId}] 📩 Message status update for ${msgId}: ${receiptStatus}`);
          }
        } catch (err) {
          logger.error(`[WA:${sessionId}] Failed to update receipt_status: ${err.message}`);
        }
      }
    }
  });

  // Handler read receipts khusus (Centang Biru)
  sock.ev.on('message-receipt.update', async (receipts) => {
    const db = getDb();
    for (const r of receipts) {
      const msgId = r.key?.id;
      if (!msgId) continue;
      const receiptType = 'read';
      try {
        const res = db.prepare(`UPDATE message_logs SET receipt_status = ?, updated_at = CURRENT_TIMESTAMP WHERE message_id = ?`).run(receiptType, msgId);
        if (res.changes > 0) {
          logger.info(`[WA:${sessionId}] 👁️ Read receipt update (centang biru) for ${msgId}`);
        }
      } catch (err) {
        logger.error(`[WA:${sessionId}] Failed to update message-receipt: ${err.message}`);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (isJidBroadcast(msg.key.remoteJid)) continue;

      // Gunakan remoteJid utuh agar format @s.whatsapp.net / @lid dapat dikirimkan kembali dengan presisi
      const remoteJid = msg.key.remoteJid || '';
      const from = remoteJid.includes('@') ? remoteJid : remoteJid + '@s.whatsapp.net';
      const text = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        ''
      ).trim();

      if (!text) continue;

      logger.debug(`[WA:${sessionId}] 📨 Inbound from ${from}: "${text}"`);

      try {
        const db = getDb();
        db.prepare(`INSERT INTO wa_events (event_type, from_phone, message, direction, session_id) VALUES (?, ?, ?, ?, ?)`).run(
          'message', from, text, 'inbound', sessionId
        );
      } catch (_) {}

      for (const handler of messageHandlers) {
        try {
          await handler({ sessionId, from, text, msg, sock });
        } catch (err) {
          logger.error(`[WA:${sessionId}] Handler error: ${err.message}`);
        }
      }
    }
  });
};

/**
 * Connect semua default sessions yang memiliki kredensial tersimpan
 */
const connectAll = async () => {
  for (const sessionId of DEFAULT_SESSIONS) {
    if (hasSessionCreds(sessionId)) {
      logger.info(`[WA:${sessionId}] Existing credentials found. Restoring connection...`);
      await connectSession(sessionId);
    } else {
      logger.info(`[WA:${sessionId}] No credentials found. Skipping auto-connect (QR will be generated on-demand).`);
    }
  }
};

/**
 * Disconnect dan logout session secara permanen (menghapus folder session)
 */
const logoutSession = async (sessionId) => {
  const sess = sessions.get(sessionId);
  if (sess) {
    if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
    if (sess.sock) {
      try {
        await sess.sock.logout();
      } catch (_) {}
      sess.sock = null;
    }
    sess.connectionStatus = 'disconnected';
    sess.qrCode = null;
  }
  const sessionPath = path.resolve(config.WA_SESSION_PATH, sessionId);
  try {
    fs.rmSync(sessionPath, { recursive: true, force: true });
  } catch (_) {}
  logger.info(`[WA:${sessionId}] Session logged out and folder cleaned.`);
  return { success: true, session: sessionId };
};

/**
 * Disconnect socket tanpa logout
 */
const disconnectSession = async (sessionId) => {
  const sess = sessions.get(sessionId);
  if (sess) {
    if (sess.reconnectTimer) clearTimeout(sess.reconnectTimer);
    if (sess.sock) {
      try {
        sess.sock.end(undefined);
      } catch (_) {}
      sess.sock = null;
    }
    sess.connectionStatus = 'disconnected';
    sess.qrCode = null;
  }
};

module.exports = {
  connectAll,
  connectSession,
  disconnectSession,
  logoutSession,
  hasSessionCreds,
  sendMessage,
  formatPhone,
  getStatus,
  getAllStatuses,
  getQR,
  onMessage,
  DEFAULT_SESSIONS,
};
