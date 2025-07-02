const crypto = require('crypto');
const { SHOPIFY_API_SECRET } = require('../config');

exports.verifyHmac = (rawBody, hmacHeader, secret = SHOPIFY_API_SECRET) => {
    const generatedHmac = crypto.createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('base64');

    return crypto.timingSafeEqual(
        Buffer.from(generatedHmac),
        Buffer.from(hmacHeader)
    );
};
