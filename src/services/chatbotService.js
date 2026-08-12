'use strict';

const { getDb } = require('../db/database');
const { sendMessage } = require('../services/whatsappService');
const logger = require('../config/logger');

/**
 * Auto-reply handler — dipanggil oleh whatsappService saat ada pesan masuk
 */
const handleInboundMessage = async ({ sessionId = 'bot', from, text }) => {
  const db = getDb();
  const lowerText = text.toLowerCase().trim();

  // Ambil semua rule yang aktif, diurutkan berdasarkan priority (tertinggi dulu)
  const rules = db.prepare(`SELECT * FROM chatbot_rules WHERE active = 1 ORDER BY priority DESC`).all();

  let matched = null;

  for (const rule of rules) {
    const keyword = rule.keyword.toLowerCase();

    if (rule.keyword_type === 'exact' && lowerText === keyword) {
      matched = rule;
      break;
    }
    if (rule.keyword_type === 'contains' && lowerText.includes(keyword)) {
      matched = rule;
      break;
    }
    if (rule.keyword_type === 'startswith' && lowerText.startsWith(keyword)) {
      matched = rule;
      break;
    }
  }

  if (!matched) {
    logger.debug(`[Chatbot:${sessionId}] No rule matched for: "${text}" from ${from}`);
    return;
  }

  logger.info(`[Chatbot:${sessionId}] 💬 Matched rule "${matched.keyword}" for ${from}`);

  try {
    const result = await sendMessage(from, matched.response, sessionId);
    
    // Log ke message_logs agar statistik dashboard (Total Messages Sent) bertambah!
    try {
      db.prepare(`INSERT INTO message_logs (session_id, message_id, phone, message, status, receipt_status) VALUES (?, ?, ?, ?, 'sent', 'sent')`).run(
        sessionId, result.messageId, from, matched.response
      );
    } catch (dbErr) {
      logger.error(`[Chatbot:${sessionId}] DB Insert message_logs error: ${dbErr.message}`);
    }

    // Log ke wa_events
    db.prepare(`INSERT INTO wa_events (event_type, from_phone, message, direction, session_id) VALUES (?, ?, ?, ?, ?)`).run(
      'chatbot_reply', from, matched.response, 'outbound', sessionId
    );
  } catch (err) {
    logger.error(`[Chatbot:${sessionId}] Failed to send reply to ${from}: ${err.message}`);
  }
};

/**
 * CRUD untuk chatbot rules
 */
const getRules = () => {
  const db = getDb();
  return db.prepare(`SELECT * FROM chatbot_rules ORDER BY priority DESC, created_at ASC`).all();
};

const createRule = ({ keyword, keyword_type = 'contains', response, priority = 0 }) => {
  const db = getDb();
  const result = db.prepare(`INSERT INTO chatbot_rules (keyword, keyword_type, response, priority) VALUES (?, ?, ?, ?)`).run(
    keyword, keyword_type, response, priority
  );
  return db.prepare(`SELECT * FROM chatbot_rules WHERE id = ?`).get(result.lastInsertRowid);
};

const updateRule = (id, fields) => {
  const db = getDb();
  const allowed = ['keyword', 'keyword_type', 'response', 'active', 'priority'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (updates.length === 0) return null;

  const set = updates.map(([k]) => `${k} = ?`).join(', ');
  const vals = updates.map(([, v]) => v);
  db.prepare(`UPDATE chatbot_rules SET ${set} WHERE id = ?`).run(...vals, id);
  return db.prepare(`SELECT * FROM chatbot_rules WHERE id = ?`).get(id);
};

const deleteRule = (id) => {
  const db = getDb();
  const result = db.prepare(`DELETE FROM chatbot_rules WHERE id = ?`).run(id);
  return result.changes > 0;
};

module.exports = { handleInboundMessage, getRules, createRule, updateRule, deleteRule };
