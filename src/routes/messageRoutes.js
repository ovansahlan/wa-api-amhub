'use strict';

const express = require('express');
const router = express.Router();
const {
  sendSingle, blastMessages, getBlastJobs,
  getBlastStatus, cancelBlast, getTemplates, previewTemplate
} = require('../controllers/messageController');

router.post('/send', sendSingle);
router.post('/blast', blastMessages);
router.get('/blast', getBlastJobs);
router.get('/blast/:jobId/status', getBlastStatus);
router.delete('/blast/:jobId', cancelBlast);
router.get('/templates', getTemplates);
router.post('/preview', previewTemplate);

module.exports = router;
