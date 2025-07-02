const axios = require('axios');
const dayjs = require('dayjs');
const XeroToken = require('../models/token.model');

const {
  XERO_CLIENT_ID,
  XERO_CLIENT_SECRET,
  XERO_REDIRECT_URI,
} = process.env;

async function getValidAccessToken() {
  const tokenDoc = await XeroToken.findOne();

  if (!tokenDoc) throw new Error('❌ No Xero token found in DB');

  const isExpired = dayjs().isAfter(dayjs(tokenDoc.expiresAt));

  if (!isExpired) {
    return {
      accessToken: tokenDoc.accessToken,
      tenantId: tokenDoc.tenantId
    };
  }

  console.log('🔄 Access token expired. Refreshing...');

  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenDoc.refreshToken,
    client_id: XERO_CLIENT_ID,
    client_secret: XERO_CLIENT_SECRET,
  });

  const res = await axios.post('https://identity.xero.com/connect/token', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token, refresh_token, expires_in } = res.data;

  tokenDoc.accessToken = access_token;
  tokenDoc.refreshToken = refresh_token;
  tokenDoc.expiresAt = dayjs().add(expires_in, 'second').toDate();
  await tokenDoc.save();

  return {
    accessToken: access_token,
    tenantId: tokenDoc.tenantId,
  };
}

// When user connects first time
async function saveInitialToken({ access_token, refresh_token, expires_in, tenantId }) {
  await XeroToken.deleteMany(); // If single-tenant
  return await XeroToken.create({
    accessToken: access_token,
    refreshToken: refresh_token,
    tenantId,
    expiresAt: dayjs().add(expires_in, 'second').toDate()
  });
}

module.exports = {
  getValidAccessToken,
  saveInitialToken,
};
