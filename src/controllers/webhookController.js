'use strict';

const { createBlastJob } = require('../services/blastService');
const { sendMessage } = require('../services/whatsappService');
const { renderTemplate } = require('../services/templateService');
const logger = require('../config/logger');

const campaignWebhook = async (req, res) => {
  const { merchants, am_name, campaign_name, campaign_details, delay_ms, session = 'bot' } = req.body;

  if (!merchants || !Array.isArray(merchants) || merchants.length === 0) {
    return res.status(400).json({ success: false, error: 'merchants harus berupa array dan tidak boleh kosong.' });
  }

  try {
    const jobId = await createBlastJob({
      name: `Campaign: ${campaign_name || 'GMS'}`,
      template: 'campaign',
      recipients: merchants.map(m => ({
        phone: m.phone,
        name: m.name,
        campaign_name: m.campaign_name || campaign_name || 'GMS Booster',
        campaign_details: m.campaign_details || campaign_details || '-',
      })),
      templateData: { am_name: am_name || 'AM Hub Team' },
      delayMs: delay_ms,
      sessionId: session,
    });

    logger.info(`[Webhook:${session}] Campaign blast triggered → Job: ${jobId}`);
    res.status(202).json({
      success: true,
      message: `Campaign blast dimulai untuk ${merchants.length} merchant (Session: ${session}).`,
      data: { jobId, session, total: merchants.length },
    });
  } catch (err) {
    logger.error(`[Webhook /campaign:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

const visitWebhook = async (req, res) => {
  const { merchant_name, phone, am_name, visit_date, visit_time, session = 'bot' } = req.body;

  if (!phone || !merchant_name) {
    return res.status(400).json({ success: false, error: 'phone dan merchant_name wajib diisi.' });
  }

  try {
    const message = renderTemplate('visit_reminder', {
      merchant_name,
      am_name: am_name || 'AM Hub Team',
      visit_date: visit_date || 'Akan dikonfirmasi',
      visit_time: visit_time || '10:00 WIB',
    });

    await sendMessage(phone, message, session);
    logger.info(`[Webhook:${session}] Visit reminder sent → ${merchant_name} (${phone})`);

    res.json({
      success: true,
      message: `Visit reminder berhasil dikirim ke ${merchant_name} (Session: ${session}).`,
      data: { session, phone, merchant_name },
    });
  } catch (err) {
    logger.error(`[Webhook /visit:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

const mcaWebhook = async (req, res) => {
  const { merchants, am_name, delay_ms, session = 'bot' } = req.body;

  if (!merchants || !Array.isArray(merchants) || merchants.length === 0) {
    return res.status(400).json({ success: false, error: 'merchants harus berupa array dan tidak boleh kosong.' });
  }

  try {
    const jobId = await createBlastJob({
      name: `MCA Reminder`,
      template: 'mca_reminder',
      recipients: merchants.map(m => ({
        phone: m.phone,
        name: m.name,
        mca_limit: m.mca_limit ? `Rp ${Number(m.mca_limit).toLocaleString('id-ID')}` : 'Lihat di Grab Merchant',
      })),
      templateData: { am_name: am_name || 'AM Hub Team' },
      delayMs: delay_ms,
      sessionId: session,
    });

    logger.info(`[Webhook:${session}] MCA reminder blast → Job: ${jobId}`);
    res.status(202).json({
      success: true,
      message: `MCA reminder dimulai untuk ${merchants.length} merchant (Session: ${session}).`,
      data: { jobId, session, total: merchants.length },
    });
  } catch (err) {
    logger.error(`[Webhook /mca:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

const customWebhook = async (req, res) => {
  const { merchants, message, delay_ms, session = 'bot' } = req.body;

  if (!merchants || !Array.isArray(merchants) || merchants.length === 0) {
    return res.status(400).json({ success: false, error: 'merchants wajib diisi.' });
  }
  if (!message) {
    return res.status(400).json({ success: false, error: 'message wajib diisi.' });
  }

  try {
    const jobId = await createBlastJob({
      name: 'Custom Blast',
      template: 'custom',
      recipients: merchants,
      customMessage: message,
      delayMs: delay_ms,
      sessionId: session,
    });

    res.status(202).json({
      success: true,
      message: `Custom blast dimulai untuk ${merchants.length} merchant (Session: ${session}).`,
      data: { jobId, session, total: merchants.length },
    });
  } catch (err) {
    logger.error(`[Webhook /custom:${session}] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = { campaignWebhook, visitWebhook, mcaWebhook, customWebhook };
