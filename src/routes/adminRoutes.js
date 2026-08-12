'use strict';

const express = require('express');
const router = express.Router();
const {
  getSchedules, addSchedule, removeSchedule,
  getChatbotRules, addChatbotRule, editChatbotRule, removeChatbotRule,
  getMessageLogs, getWaEvents,
  getTemplates, addTemplate, editTemplate, removeTemplate,
} = require('../controllers/adminController');

// Scheduler
router.get('/schedules', getSchedules);
router.post('/schedules', addSchedule);
router.delete('/schedules/:id', removeSchedule);

// Chatbot rules
router.get('/chatbot/rules', getChatbotRules);
router.post('/chatbot/rules', addChatbotRule);
router.put('/chatbot/rules/:id', editChatbotRule);
router.delete('/chatbot/rules/:id', removeChatbotRule);

// Templates
router.get('/templates', getTemplates);
router.post('/templates', addTemplate);
router.put('/templates/:id', editTemplate);
router.delete('/templates/:id', removeTemplate);

// Logs
router.get('/logs/messages', getMessageLogs);
router.get('/logs/events', getWaEvents);

module.exports = router;
