const express = require('express');
const router = express.Router();
const { getHome, receiveWebhook } = require('../controllers/webhook.controller');

router.get('/', getHome);
router.post('/inventory', receiveWebhook);


module.exports = router;
