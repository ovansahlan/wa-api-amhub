'use strict';

const express = require('express');
const router = express.Router();
const { getConnectionStatus, getAllSessions, getQRPage, getQRJson, triggerConnectSession, triggerLogoutSession } = require('../controllers/statusController');

const path = require('path');

router.get('/status', getConnectionStatus);
router.get('/sessions', getAllSessions);
router.post('/sessions/:session/connect', triggerConnectSession);
router.post('/sessions/:session/logout', triggerLogoutSession);
router.get('/qr', getQRPage);
router.get('/qr-json', getQRJson);
router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

module.exports = router;
