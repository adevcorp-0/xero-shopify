const express = require('express');
const router = express.Router();
const { getHome, receiveWebhook } = require('../controllers/webhook.controller');

router.post('/inventory', receiveWebhook);
router.post('/inventory/orders', receiveWebhook);

module.exports = router;
