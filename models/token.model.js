const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
    accessToken: String,
    refreshToken: String,
    tenantId: String,
    expiresAt: Date // When access token will expire
}, { collection: 'xero_tokens' });

module.exports = mongoose.model('XeroToken', tokenSchema);