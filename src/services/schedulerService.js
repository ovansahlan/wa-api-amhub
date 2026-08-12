'use strict';

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');
const { createBlastJob } = require('./blastService');
const logger = require('../config/logger');

// In-memory: id → cron task
const activeTasks = new Map();

/**
 * Muat semua scheduled jobs dari DB dan jalankan
 */
const loadSchedules = () => {
  const db = getDb();
  const jobs = db.prepare(`SELECT * FROM scheduled_jobs WHERE active = 1`).all();

  for (const job of jobs) {
    registerTask(job);
  }

  logger.info(`[Scheduler] Loaded ${jobs.length} scheduled job(s)`);
};

/**
 * Daftarkan satu scheduled task ke node-cron
 */
const registerTask = (job) => {
  if (!cron.validate(job.cron_expr)) {
    logger.warn(`[Scheduler] Invalid cron expression for job "${job.name}": ${job.cron_expr}`);
    return;
  }

  if (activeTasks.has(job.id)) {
    activeTasks.get(job.id).stop();
  }

  const task = cron.schedule(job.cron_expr, async () => {
    logger.info(`[Scheduler] ⏰ Running job "${job.name}" (${job.id})`);
    try {
      let payload = {};
      try { payload = JSON.parse(job.payload || '{}'); } catch (_) {}
      await executeScheduledJob(job.type, payload);
    } catch (err) {
      logger.error(`[Scheduler] Job "${job.name}" failed: ${err.message}`);
    }
  }, {
    timezone: 'Asia/Jakarta',
  });

  activeTasks.set(job.id, task);
  logger.info(`[Scheduler] ✅ Registered: "${job.name}" @ ${job.cron_expr}`);
};

/**
 * Eksekusi payload sesuai tipe job
 */
const executeScheduledJob = async (type, payload) => {
  switch (type) {
    case 'blast':
      await createBlastJob({
        name: payload.name || 'Scheduled Blast',
        template: payload.template || 'custom',
        recipients: payload.recipients || [],
        templateData: payload.templateData || {},
        customMessage: payload.customMessage || null,
        delayMs: payload.delayMs,
      });
      break;

    default:
      logger.warn(`[Scheduler] Unknown job type: ${type}`);
  }
};

/**
 * Buat scheduled job baru
 */
const createSchedule = (options) => {
  const { name, cron_expr, type, payload } = options;

  if (!cron.validate(cron_expr)) {
    throw new Error(`Invalid cron expression: "${cron_expr}"`);
  }

  const db = getDb();
  const id = uuidv4();

  db.prepare(`
    INSERT INTO scheduled_jobs (id, name, cron_expr, type, payload, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, name, cron_expr, type, JSON.stringify(payload || {}));

  const job = db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`).get(id);
  registerTask(job);

  return job;
};

/**
 * Hapus scheduled job
 */
const deleteSchedule = (id) => {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM scheduled_jobs WHERE id = ?`).get(id);
  if (!job) return false;

  const task = activeTasks.get(id);
  if (task) {
    task.stop();
    activeTasks.delete(id);
  }

  db.prepare(`DELETE FROM scheduled_jobs WHERE id = ?`).run(id);
  logger.info(`[Scheduler] Deleted job "${job.name}" (${id})`);
  return true;
};

/**
 * List semua scheduled jobs
 */
const listSchedules = () => {
  const db = getDb();
  return db.prepare(`SELECT * FROM scheduled_jobs ORDER BY created_at DESC`).all().map(job => ({
    ...job,
    is_running: activeTasks.has(job.id),
  }));
};

module.exports = { loadSchedules, createSchedule, deleteSchedule, listSchedules };
