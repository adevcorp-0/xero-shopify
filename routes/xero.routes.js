const express = require('express');
const router = express.Router();
const { redirectToXero, xeroCallback } = require('../controllers/xero.controller');

router.get('/redirect', redirectToXero);
router.get('/callback', xeroCallback);

module.exports = router; 