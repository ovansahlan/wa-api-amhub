'use strict';

const { sendMessage } = require('../services/whatsappService');
const { createBlastJob, getJobStatus, cancelJob, listJobs } = require('../services/blastService');
const { renderTemplate, listTemplates } = require('../services/templateService');
const logger = require('../config/logger');

const sendSingle = async (req, res) => {
  const { phone, message, session = 'bot' } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone dan message wajib diisi.' });
  }

  try {
    const result = await sendMessage(phone, message, session);
    
    // Log ke DB untuk Message Tracker Dashboard
    try {
      const { getDb } = require('../db/database');
      const db = getDb();
      db.prepare(`INSERT INTO message_logs (session_id, message_id, phone, message, status, receipt_status) VALUES (?, ?, ?, ?, 'sent', 'sent')`).run(
        session, result.messageId, phone, message
      );
    } catch (_) {}

    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`[API /send:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

const blastMessages = async (req, res) => {
  const { name, template = 'custom', recipients, templateData = {}, customMessage, delay_ms, session = 'bot' } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ success: false, error: 'recipients harus berupa array dan tidak boleh kosong.' });
  }

  if (template === 'custom' && !customMessage) {
    return res.status(400).json({ success: false, error: 'customMessage wajib diisi jika template = custom.' });
  }

  try {
    const jobId = await createBlastJob({
      name,
      template,
      recipients,
      templateData,
      customMessage,
      delayMs: delay_ms,
      sessionId: session,
    });
    res.status(202).json({
      success: true,
      message: `Blast job (${session}) dimulai. Gunakan GET /api/blast/${jobId}/status untuk cek progress.`,
      data: { jobId, session, total: recipients.length },
    });
  } catch (err) {
    logger.error(`[API /blast:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

const getBlastJobs = (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const jobs = listJobs(limit);
  res.json({ success: true, data: jobs });
};

const getBlastStatus = (req, res) => {
  const { jobId } = req.params;
  const job = getJobStatus(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: `Job "${jobId}" tidak ditemukan.` });
  }
  res.json({ success: true, data: job });
};

const cancelBlast = (req, res) => {
  const { jobId } = req.params;
  const cancelled = cancelJob(jobId);
  if (!cancelled) {
    return res.status(404).json({ success: false, error: `Job "${jobId}" tidak ditemukan atau sudah selesai.` });
  }
  res.json({ success: true, message: `Job "${jobId}" sedang dihentikan.` });
};

const getTemplates = (req, res) => {
  res.json({ success: true, data: listTemplates() });
};

const previewTemplate = (req, res) => {
  const { template = 'custom', data = {}, customMessage } = req.body;
  try {
    const rendered = renderTemplate(template, data, customMessage);
    res.json({ success: true, data: { rendered } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

module.exports = { sendSingle, blastMessages, getBlastJobs, getBlastStatus, cancelBlast, getTemplates, previewTemplate };
