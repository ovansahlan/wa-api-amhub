'use strict';

require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3001,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Security
  API_KEY: process.env.API_KEY || 'changeme-api-key-amhub-2024',

  // WhatsApp
  WA_SESSION_PATH: process.env.WA_SESSION_PATH || './auth_info_baileys',
  WA_RECONNECT_INTERVAL: parseInt(process.env.WA_RECONNECT_INTERVAL || '5000'),

  // Blast Settings
  BLAST_DEFAULT_DELAY_MS: parseInt(process.env.BLAST_DEFAULT_DELAY_MS || '3000'),
  BLAST_MIN_DELAY_MS: parseInt(process.env.BLAST_MIN_DELAY_MS || '2000'),
  BLAST_MAX_DELAY_MS: parseInt(process.env.BLAST_MAX_DELAY_MS || '10000'),

  // Database
  DB_PATH: process.env.DB_PATH || './data/amhub.db',

  // Supabase (Optional for Cloud Session Persistence)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_KEY: process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // AM Hub Integration (optional webhook origin)
  AMHUB_ORIGIN: process.env.AMHUB_ORIGIN || '*',
};
