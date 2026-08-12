'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const TEMPLATES_DIR = path.resolve('./templates');

// ── Template definitions ──────────────────────────────────────────────────────
const TEMPLATE_DEFS = {
  visit_reminder: {
    file: 'visit_reminder.txt',
    vars: ['merchant_name', 'am_name', 'visit_date', 'visit_time'],
  },
  mca_reminder: {
    file: 'mca_reminder.txt',
    vars: ['merchant_name', 'am_name', 'mca_limit'],
  },
  campaign: {
    file: 'campaign.txt',
    vars: ['merchant_name', 'am_name', 'campaign_name', 'campaign_details'],
  },
  campaign_update: {
    file: 'campaign_update.txt',
    vars: ['merchant_name', 'am_name', 'update_details'],
  },
  custom: {
    file: null,
    vars: [],
  },
};

const { getDb } = require('../db/database');

/**
 * List semua template dari database
 */
const listTemplates = () => {
  const db = getDb();
  const dbTemplates = db.prepare(`SELECT * FROM message_templates ORDER BY id ASC`).all();
  return dbTemplates.map(t => {
    // Extract variables inside {{var_name}}
    const vars = (t.content.match(/\{\{(\w+)\}\}/g) || []).map(v => v.replace(/[\{\}]/g, ''));
    return {
      id: t.id,
      name: t.name,
      title: t.title,
      content: t.content,
      requiredVars: [...new Set(vars)],
      created_at: t.created_at,
      updated_at: t.updated_at
    };
  });
};

/**
 * Ambil template berdasarkan name
 */
const getTemplateByName = (name) => {
  const db = getDb();
  return db.prepare(`SELECT * FROM message_templates WHERE name = ?`).get(name);
};

/**
 * Buat template baru
 */
const createTemplate = ({ name, title, content }) => {
  const db = getDb();
  const cleanName = name.toLowerCase().trim().replace(/\s+/g, '_');
  const res = db.prepare(`INSERT INTO message_templates (name, title, content) VALUES (?, ?, ?)`).run(cleanName, title, content);
  return { id: res.lastInsertRowid, name: cleanName, title, content };
};

/**
 * Update template
 */
const updateTemplate = (id, { name, title, content }) => {
  const db = getDb();
  const cleanName = name ? name.toLowerCase().trim().replace(/\s+/g, '_') : null;
  const existing = db.prepare(`SELECT * FROM message_templates WHERE id = ?`).get(id);
  if (!existing) throw new Error('Template tidak ditemukan.');

  const updatedName = cleanName || existing.name;
  const updatedTitle = title || existing.title;
  const updatedContent = content || existing.content;

  db.prepare(`UPDATE message_templates SET name = ?, title = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    updatedName, updatedTitle, updatedContent, id
  );
  return { id, name: updatedName, title: updatedTitle, content: updatedContent };
};

/**
 * Hapus template
 */
const deleteTemplate = (id) => {
  const db = getDb();
  const res = db.prepare(`DELETE FROM message_templates WHERE id = ?`).run(id);
  return res.changes > 0;
};

/**
 * Render template dengan mengganti variabel {{var_name}} secara dinamis
 * @param {string} templateName - Nama template (misal: 'visit_reminder' atau 'custom')
 * @param {Object} data - Objek data untuk mengisi variabel {{key}}
 * @param {string} [customMessage] - Jika pakai template "custom", isi pesan langsung
 */
const renderTemplate = (templateName, data = {}, customMessage = null) => {
  let content;

  if (templateName === 'custom') {
    if (!customMessage) throw new Error('Custom template membutuhkan parameter customMessage.');
    content = customMessage;
  } else {
    const tpl = getTemplateByName(templateName);
    if (!tpl) {
      // Fallback ke file .txt jika ada di folder templates
      const filePath = path.join(TEMPLATES_DIR, `${templateName}.txt`);
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8');
      } else {
        throw new Error(`Template "${templateName}" tidak ditemukan di database atau folder templates.`);
      }
    } else {
      content = tpl.content;
    }
  }

  // Replace semua {{variable}} secara dinamis dengan data yang disuplai
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    if (val === undefined || val === null) {
      logger.warn(`[Template] Variabel "{{${key}}}" tidak disuplai untuk template "${templateName}"`);
      return `[${key}]`; // Placeholder fallback jika data kosong
    }
    return String(val);
  });
};

module.exports = {
  renderTemplate,
  listTemplates,
  getTemplateByName,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
