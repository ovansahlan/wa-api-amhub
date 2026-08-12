'use strict';

const { createSchedule, deleteSchedule, listSchedules } = require('../services/schedulerService');
const { listTemplates, createTemplate, updateTemplate, deleteTemplate } = require('../services/templateService');
const { getRules, createRule, updateRule, deleteRule } = require('../services/chatbotService');
const { getDb } = require('../db/database');
const logger = require('../config/logger');

// ── Scheduler ──────────────────────────────────────────────────────────────────

/**
 * GET /api/schedules
 */
const getSchedules = (req, res) => {
  const schedules = listSchedules();
  res.json({ success: true, data: schedules });
};

/**
 * POST /api/schedules
 * Body: { name, cron_expr, type, payload }
 */
const addSchedule = (req, res) => {
  const { name, cron_expr, type, payload } = req.body;
  if (!name || !cron_expr || !type) {
    return res.status(400).json({ success: false, error: 'name, cron_expr, dan type wajib diisi.' });
  }

  try {
    const schedule = createSchedule({ name, cron_expr, type, payload });
    res.status(201).json({ success: true, data: schedule });
  } catch (err) {
    logger.error(`[API /schedules POST] ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/schedules/:id
 */
const removeSchedule = (req, res) => {
  const deleted = deleteSchedule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Schedule tidak ditemukan.' });
  }
  res.json({ success: true, message: 'Schedule dihapus.' });
};

// ── Chatbot Rules ──────────────────────────────────────────────────────────────

/**
 * GET /api/chatbot/rules
 */
const getChatbotRules = (req, res) => {
  res.json({ success: true, data: getRules() });
};

/**
 * POST /api/chatbot/rules
 */
const addChatbotRule = (req, res) => {
  const { keyword, keyword_type, response, priority } = req.body;
  if (!keyword || !response) {
    return res.status(400).json({ success: false, error: 'keyword dan response wajib diisi.' });
  }
  const rule = createRule({ keyword, keyword_type, response, priority });
  res.status(201).json({ success: true, data: rule });
};

/**
 * PUT /api/chatbot/rules/:id
 */
const editChatbotRule = (req, res) => {
  const updated = updateRule(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Rule tidak ditemukan.' });
  }
  res.json({ success: true, data: updated });
};

/**
 * DELETE /api/chatbot/rules/:id
 */
const removeChatbotRule = (req, res) => {
  const deleted = deleteRule(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Rule tidak ditemukan.' });
  }
  res.json({ success: true, message: 'Rule dihapus.' });
};

// ── Message Logs ───────────────────────────────────────────────────────────────

/**
 * GET /api/logs/messages
 * Query: ?limit=50&status=sent|failed|pending
 */
const getMessageLogs = (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 50;
  const status = req.query.status;

  let query = `SELECT * FROM message_logs`;
  const params = [];
  if (status) { query += ` WHERE status = ?`; params.push(status); }
  query += ` ORDER BY sent_at DESC LIMIT ?`;
  params.push(limit);

  const logs = db.prepare(query).all(...params);
  const stats = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN receipt_status = 'read' THEN 1 ELSE 0 END) as read_count FROM message_logs`).get();
  const blastStats = db.prepare(`SELECT COUNT(*) as total_jobs FROM blast_jobs`).get();

  res.json({
    success: true,
    data: logs,
    summary: {
      total: stats.total || 0,
      readCount: stats.read_count || 0,
      totalBlastJobs: blastStats.total_jobs || 0,
    }
  });
};

/**
 * GET /api/logs/events
 * Query: ?limit=50&direction=inbound|outbound
 */
const getWaEvents = (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit) || 50;
  const direction = req.query.direction;

  let query = `SELECT * FROM wa_events`;
  const params = [];
  if (direction) { query += ` WHERE direction = ?`; params.push(direction); }
  query += ` ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);

  const events = db.prepare(query).all(...params);
  res.json({ success: true, data: events });
};

// ── Message Templates ──────────────────────────────────────────────────────────

/**
 * GET /api/templates
 */
const getTemplates = (req, res) => {
  res.json({ success: true, data: listTemplates() });
};

/**
 * POST /api/templates
 */
const addTemplate = (req, res) => {
  const { name, title, content } = req.body;
  if (!name || !title || !content) {
    return res.status(400).json({ success: false, error: 'name, title, dan content wajib diisi.' });
  }
  try {
    const tpl = createTemplate({ name, title, content });
    res.status(201).json({ success: true, data: tpl });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

/**
 * PUT /api/templates/:id
 */
const editTemplate = (req, res) => {
  try {
    const tpl = updateTemplate(req.params.id, req.body);
    res.json({ success: true, data: tpl });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

/**
 * DELETE /api/templates/:id
 */
const removeTemplate = (req, res) => {
  const deleted = deleteTemplate(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Template tidak ditemukan.' });
  }
  res.json({ success: true, message: 'Template berhasil dihapus.' });
};

module.exports = {
  getSchedules, addSchedule, removeSchedule,
  getChatbotRules, addChatbotRule, editChatbotRule, removeChatbotRule,
  getMessageLogs, getWaEvents,
  getTemplates, addTemplate, editTemplate, removeTemplate,
};
