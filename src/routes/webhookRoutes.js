'use strict';

const express = require('express');
const router = express.Router();
const { campaignWebhook, visitWebhook, mcaWebhook, customWebhook } = require('../controllers/webhookController');

router.post('/campaign', campaignWebhook);
router.post('/visit', visitWebhook);
router.post('/mca', mcaWebhook);
router.post('/custom', customWebhook);

module.exports = router;
