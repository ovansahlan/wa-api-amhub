'use strict';

const { v4: uuidv4 } = require('uuid');
const { sendMessage } = require('./whatsappService');
const { renderTemplate } = require('./templateService');
const { getDb } = require('../db/database');
const config = require('../config/config');
const logger = require('../config/logger');

const jobControls = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createBlastJob = async (options) => {
  const {
    name,
    template,
    recipients,
    templateData = {},
    customMessage = null,
    delayMs = config.BLAST_DEFAULT_DELAY_MS,
    sessionId = 'bot',
  } = options;

  if (!recipients || recipients.length === 0) {
    throw new Error('Recipients tidak boleh kosong.');
  }

  const effectiveDelay = Math.min(
    Math.max(delayMs, config.BLAST_MIN_DELAY_MS),
    config.BLAST_MAX_DELAY_MS
  );

  const jobId = uuidv4();
  const db = getDb();

  db.prepare(`
    INSERT INTO blast_jobs (id, name, template, total, status)
    VALUES (?, ?, ?, ?, 'queued')
  `).run(jobId, name || `Blast ${template} (${sessionId})`, template, recipients.length);

  jobControls.set(jobId, { cancelled: false });

  logger.info(`[Blast:${sessionId}] 🚀 Job ${jobId} created. ${recipients.length} recipients, delay ${effectiveDelay}ms`);

  runBlast(jobId, template, recipients, templateData, customMessage, effectiveDelay, sessionId);

  return jobId;
};

const runBlast = async (jobId, template, recipients, baseData, customMessage, delayMs, sessionId) => {
  const db = getDb();

  db.prepare(`UPDATE blast_jobs SET status = 'sending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i++) {
    const ctrl = jobControls.get(jobId);
    if (ctrl?.cancelled) {
      logger.info(`[Blast:${sessionId}] ⛔ Job ${jobId} cancelled at ${i}/${recipients.length}`);
      break;
    }

    const recipient = recipients[i];
    const { phone, name: merchantName, ...extraData } = recipient;

    const data = {
      ...baseData,
      merchant_name: merchantName || phone,
      ...extraData,
    };

    let message;
    try {
      message = renderTemplate(template, data, customMessage);
    } catch (err) {
      logger.error(`[Blast:${sessionId}] Template render error for ${phone}: ${err.message}`);
      failed++;
      db.prepare(`INSERT INTO message_logs (job_id, session_id, phone, merchant_name, message, status, error) VALUES (?, ?, ?, ?, ?, 'failed', ?)`).run(
        jobId, sessionId, phone, merchantName, customMessage || template, err.message
      );
      continue;
    }

    try {
      const res = await sendMessage(phone, message, sessionId);
      sent++;
      db.prepare(`INSERT INTO message_logs (job_id, session_id, message_id, phone, merchant_name, message, status, receipt_status) VALUES (?, ?, ?, ?, ?, ?, 'sent', 'sent')`).run(
        jobId, sessionId, res.messageId, phone, merchantName, message
      );
      logger.info(`[Blast:${sessionId}] [${i + 1}/${recipients.length}] ✅ ${merchantName || phone}`);
    } catch (err) {
      failed++;
      db.prepare(`INSERT INTO message_logs (job_id, session_id, phone, merchant_name, message, status, error) VALUES (?, ?, ?, ?, ?, 'failed', ?)`).run(
        jobId, sessionId, phone, merchantName, message, err.message
      );
      logger.warn(`[Blast:${sessionId}] [${i + 1}/${recipients.length}] ❌ ${merchantName || phone}: ${err.message}`);
    }

    db.prepare(`UPDATE blast_jobs SET sent = ?, failed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(sent, failed, jobId);

    if (i < recipients.length - 1) {
      await sleep(delayMs);
    }
  }

  const ctrl = jobControls.get(jobId);
  const finalStatus = ctrl?.cancelled ? 'cancelled' : (failed === recipients.length ? 'failed' : 'completed');
  db.prepare(`UPDATE blast_jobs SET status = ?, sent = ?, failed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    finalStatus, sent, failed, jobId
  );
  jobControls.delete(jobId);
  logger.info(`[Blast:${sessionId}] 🏁 Job ${jobId} ${finalStatus}. Sent: ${sent}, Failed: ${failed}`);
};

const getJobStatus = (jobId) => {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM blast_jobs WHERE id = ?`).get(jobId);
  if (!job) return null;

  const logs = db.prepare(`SELECT session_id, phone, merchant_name, status, error, sent_at FROM message_logs WHERE job_id = ? ORDER BY sent_at DESC LIMIT 50`).all(jobId);
  return { ...job, logs };
};

const cancelJob = (jobId) => {
  const ctrl = jobControls.get(jobId);
  if (!ctrl) return false;
  ctrl.cancelled = true;
  return true;
};

const listJobs = (limit = 20) => {
  const db = getDb();
  return db.prepare(`SELECT * FROM blast_jobs ORDER BY created_at DESC LIMIT ?`).all(limit);
};

module.exports = { createBlastJob, getJobStatus, cancelJob, listJobs };
