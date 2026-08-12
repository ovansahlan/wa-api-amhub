'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../config/logger');

const DB_DIR = path.dirname(config.DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db;

const getDb = () => {
  if (!db) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    logger.info(`[DB] Connected to SQLite: ${config.DB_PATH}`);
    runMigrations(db);
  }
  return db;
};

const runMigrations = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS blast_jobs (
      id TEXT PRIMARY KEY,
      name TEXT,
      template TEXT,
      total INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT,
      session_id TEXT DEFAULT 'bot',
      message_id TEXT,
      phone TEXT NOT NULL,
      merchant_name TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      receipt_status TEXT DEFAULT 'sent',
      error TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (job_id) REFERENCES blast_jobs(id)
    );

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expr TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chatbot_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      keyword_type TEXT DEFAULT 'contains',
      response TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wa_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      session_id TEXT DEFAULT 'bot',
      from_phone TEXT,
      message TEXT,
      direction TEXT DEFAULT 'inbound',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Auto-migration untuk SQLite DB lama yang belum punya kolom session_id & message_id
  try {
    db.exec(`ALTER TABLE wa_events ADD COLUMN session_id TEXT DEFAULT 'bot';`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE message_logs ADD COLUMN session_id TEXT DEFAULT 'bot';`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE message_logs ADD COLUMN message_id TEXT;`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE message_logs ADD COLUMN receipt_status TEXT DEFAULT 'sent';`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE message_logs ADD COLUMN updated_at DATETIME;`);
  } catch (_) {}

  // Seed default templates jika tabel kosong
  const tplCount = db.prepare('SELECT COUNT(*) as c FROM message_templates').get();
  if (tplCount.c === 0) {
    const insertTpl = db.prepare(`INSERT INTO message_templates (name, title, content) VALUES (?, ?, ?)`);
    const seedTemplates = [
      [
        'visit_reminder',
        'Visit Reminder AM',
        'Halo, *{{merchant_name}}* 👋\n\nKami ingin menginformasikan bahwa Account Manager GrabFood kami, *{{am_name}}*, berencana untuk berkunjung ke outlet Anda:\n\n📅 *Tanggal:* {{visit_date}}\n🕐 *Waktu:* {{visit_time}}\n\nKunjungan ini bertujuan untuk membantu mengoptimalkan performa outlet Anda di GrabFood — mulai dari campaign, performa penjualan, hingga peluang Grab Modal 🚀\n\nMohon konfirmasi ketersediaan Anda. Jika ada perubahan jadwal, jangan ragu untuk menghubungi kami kembali.\n\nTerima kasih banyak! 🙏\n\n_AM Hub · GrabFood Indonesia_'
      ],
      [
        'mca_reminder',
        'Grab Modal (MCA) Reminder',
        'Selamat *{{merchant_name}}*! 💰\n\nToko Anda terpilih mendapatkan fasilitas Modal Usaha (MCA) hingga *{{mca_limit}}* dari GrabFood.\n\nHubungi AM *{{am_name}}* untuk cek limit dan klaim pencairan modal usaha Anda sekarang! 🚀\n\n_AM Hub · GrabFood Indonesia_'
      ],
      [
        'campaign',
        'Info Campaign GrabFood',
        'Hi *{{merchant_name}}*! 🎯\n\nIkuti Campaign *{{campaign_name}}* bulan ini untuk meningkatkan omset toko Anda!\n\nDetails: {{campaign_details}}\n\nInfo lengkap & pendaftaran hubungi AM *{{am_name}}*. 🚀'
      ]
    ];
    seedTemplates.forEach(t => insertTpl.run(...t));
    logger.info('[DB] Seeded default message templates');
  }

  // Seed default chatbot rules jika tabel kosong
  const count = db.prepare('SELECT COUNT(*) as c FROM chatbot_rules').get();
  if (count.c === 0) {
    const insert = db.prepare(`
      INSERT INTO chatbot_rules (keyword, keyword_type, response, priority)
      VALUES (?, ?, ?, ?)
    `);
    const seedRules = [
      ['halo', 'contains', 'Halo! 👋 Terima kasih sudah menghubungi AM Hub GrabFood. Ada yang bisa kami bantu?\n\nKetik *MENU* untuk melihat pilihan.', 10],
      ['hi', 'contains', 'Halo! 👋 Terima kasih sudah menghubungi AM Hub GrabFood. Ada yang bisa kami bantu?\n\nKetik *MENU* untuk melihat pilihan.', 10],
      ['menu', 'exact', '📋 *Menu Layanan AM Hub*\n\n1️⃣ *CAMPAIGN* — Info campaign aktif\n2️⃣ *MODAL* — Info Grab Modal (MCA)\n3️⃣ *KUNJUNGAN* — Jadwal kunjungan AM\n4️⃣ *KONTAK* — Hubungi AM Anda\n\nBalas dengan angka atau kata kunci.', 20],
      ['campaign', 'contains', '🎯 *Info Campaign GrabFood*\n\nUntuk informasi campaign terbaru yang tersedia untuk outlet Anda, silakan hubungi Account Manager Anda secara langsung.\n\nAM Hub Team - GrabFood Indonesia 🚀', 5],
      ['modal', 'contains', '💰 *Info Grab Modal (MCA)*\n\nGrab Modal adalah fasilitas pinjaman khusus untuk mitra GrabFood. Eligibilitas bergantung pada performa outlet Anda.\n\nHubungi AM Anda untuk cek limit dan proses pengajuan! 📲', 5],
      ['kontak', 'contains', '📞 *Hubungi AM Anda*\n\nAccount Manager kami siap membantu Anda pada jam kerja:\n⏰ Senin - Jumat: 09.00 - 18.00 WIB\n\nSilakan hubungi AM Anda langsung untuk bantuan lebih lanjut.', 5],
      ['terima kasih', 'contains', 'Sama-sama! 😊 Senang bisa membantu. Jangan ragu menghubungi kami jika ada pertanyaan lain.\n\n_AM Hub - GrabFood Indonesia_ 🚀', 5],
      ['thanks', 'contains', 'Sama-sama! 😊 Senang bisa membantu. Jangan ragu menghubungi kami jika ada pertanyaan lain.\n\n_AM Hub - GrabFood Indonesia_ 🚀', 5],
    ];
    seedRules.forEach(r => insert.run(...r));
    logger.info('[DB] Seeded default chatbot rules');
  }

  logger.info('[DB] Migrations completed');
};

module.exports = { getDb };
