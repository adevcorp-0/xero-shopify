const Shopify = require('shopify-api-node');
const shopify = new Shopify({
    shopName: process.env.SHOPIFY_STORE_DOMAIN,
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    apiVersion: '2024-10'
});
module.exports = shopify;