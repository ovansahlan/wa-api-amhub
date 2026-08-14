'use strict';

const { createClient } = require('@supabase/supabase-js');
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');
const logger = require('../config/logger');

let supabaseClient = null;

const getSupabaseClient = () => {
  if (!supabaseClient && config.SUPABASE_URL && config.SUPABASE_KEY) {
    supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
  }
  return supabaseClient;
};

const isSupabaseEnabled = () => {
  return !!(config.SUPABASE_URL && config.SUPABASE_KEY);
};

/**
 * Cek apakah session memiliki kredensial di Supabase
 */
const hasSupabaseCreds = async (sessionId) => {
  const supabase = getSupabaseClient();
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .from('wa_sessions')
      .select('data')
      .eq('session_id', sessionId)
      .eq('key_id', 'creds')
      .maybeSingle();

    if (error || !data || !data.data) return false;
    const creds = JSON.parse(data.data);
    return !!(creds && creds.me && creds.me.id);
  } catch (err) {
    logger.error(`[SupabaseAuth:${sessionId}] Error checking creds: ${err.message}`);
    return false;
  }
};

/**
 * Adapter Auth State Baileys berbasis Supabase
 */
const useSupabaseAuthState = async (sessionId, sessionPath) => {
  const supabase = getSupabaseClient();

  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  // 1. Sync data dari Supabase ke disk lokal saat startup
  if (supabase) {
    logger.info(`[SupabaseAuth:${sessionId}] 📥 Fetching session keys from Supabase...`);
    try {
      const { data, error } = await supabase
        .from('wa_sessions')
        .select('key_id, data')
        .eq('session_id', sessionId);

      if (error) {
        logger.error(`[SupabaseAuth:${sessionId}] Error fetching keys: ${error.message}`);
      } else if (data && data.length > 0) {
        for (const row of data) {
          const filePath = path.join(sessionPath, `${row.key_id}.json`);
          fs.writeFileSync(filePath, row.data, 'utf-8');
        }
        logger.info(`[SupabaseAuth:${sessionId}] ✅ Downloaded ${data.length} auth key file(s) from Supabase.`);
      } else {
        logger.info(`[SupabaseAuth:${sessionId}] No existing auth keys found in Supabase.`);
      }
    } catch (err) {
      logger.error(`[SupabaseAuth:${sessionId}] Exception downloading auth state: ${err.message}`);
    }
  }

  // 2. Inisialisasi useMultiFileAuthState bawaan Baileys
  const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(sessionPath);

  // 3. Helper upsert ke Supabase
  const upsertKeyToSupabase = async (keyId, rawContent) => {
    if (!supabase) return;
    try {
      const { error } = await supabase
        .from('wa_sessions')
        .upsert({
          session_id: sessionId,
          key_id: keyId,
          data: typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'session_id,key_id' });

      if (error) {
        logger.error(`[SupabaseAuth:${sessionId}] Error upserting ${keyId}: ${error.message}`);
      }
    } catch (err) {
      logger.error(`[SupabaseAuth:${sessionId}] Exception upserting ${keyId}: ${err.message}`);
    }
  };

  // 4. Helper delete dari Supabase
  const deleteKeyFromSupabase = async (keyId) => {
    if (!supabase) return;
    try {
      const { error } = await supabase
        .from('wa_sessions')
        .delete()
        .eq('session_id', sessionId)
        .eq('key_id', keyId);

      if (error) {
        logger.error(`[SupabaseAuth:${sessionId}] Error deleting ${keyId}: ${error.message}`);
      }
    } catch (err) {
      logger.error(`[SupabaseAuth:${sessionId}] Exception deleting ${keyId}: ${err.message}`);
    }
  };

  // 5. Wrap saveCreds untuk update 'creds' ke Supabase
  const saveCreds = async () => {
    await originalSaveCreds();
    const credsPath = path.join(sessionPath, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const raw = fs.readFileSync(credsPath, 'utf-8');
      await upsertKeyToSupabase('creds', raw);
    }
  };

  // 6. Wrap state.keys.set untuk update signal keys ke Supabase
  const originalKeysSet = state.keys.set;
  state.keys.set = async (data) => {
    await originalKeysSet(data);
    if (!supabase) return;

    for (const category in data) {
      for (const id in data[category]) {
        const value = data[category][id];
        const keyId = `${category}-${id}`;
        if (value) {
          await upsertKeyToSupabase(keyId, value);
        } else {
          await deleteKeyFromSupabase(keyId);
        }
      }
    }
  };

  return { state, saveCreds };
};

/**
 * Hapus data sesi dari Supabase saat user melakukan logout
 */
const clearSupabaseSession = async (sessionId) => {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('wa_sessions')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      logger.error(`[SupabaseAuth:${sessionId}] Error clearing session: ${error.message}`);
    } else {
      logger.info(`[SupabaseAuth:${sessionId}] 🗑️ Cleared session keys from Supabase.`);
    }
  } catch (err) {
    logger.error(`[SupabaseAuth:${sessionId}] Exception clearing session: ${err.message}`);
  }
};

module.exports = {
  isSupabaseEnabled,
  hasSupabaseCreds,
  useSupabaseAuthState,
  clearSupabaseSession,
};
