const crypto = require('crypto');
const { getValidAccessToken } = require('../services/xeroToken.service');
const { XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI } = require('../config');
const axios = require('axios');

exports.redirectToXero = (req, res) => {
    console.log("Thsi is")
    const state = crypto.randomBytes(8).toString('hex');
    const url = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${XERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(XERO_REDIRECT_URI)}&scope=openid profile email accounting.settings accounting.contacts accounting.transactions offline_access&state=${state}`;
    res.redirect(url);
};

exports.xeroCallback = async (req, res) => {
    const { code } = req.query;

    try {
        const tokenRes = await axios.post('https://identity.xero.com/connect/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: XERO_REDIRECT_URI,
                client_id: XERO_CLIENT_ID,
                client_secret: XERO_CLIENT_SECRET
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const tokens = tokenRes.data;

        const connectionRes = await axios.get('https://api.xero.com/connections', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });

        const tenantId = connectionRes.data?.[0]?.tenantId;
        await saveInitialToken({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            tenantId,
        });
        res.send(`
                <h1>✅ Connected to Xero</h1>
                <p><strong>Access Token:</strong> ${tokens.access_token}</p>
                <p><strong>Refresh Token:</strong> ${tokens.refresh_token}</p>
                <p><strong>Tenant ID:</strong> ${tenantId}</p>
                <p style="color:red;"><strong>⚠️ Save this info. It won’t be stored by the system.</strong></p>
                <a href="/">⬅️ Back to Home</a>
            `);
    } catch (err) {
        console.error("❌ Xero OAuth Error:", err.response?.data || err.message);
        res.send('<p>Something went wrong connecting to Xero.</p><a href="/">⬅️ Back</a>');
    }
};