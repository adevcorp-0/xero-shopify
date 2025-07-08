const { verifyHmac } = require('../utils/hmac.util');
const { getValidAccessToken } = require('../services/xeroToken.service');
const shopifySyncService = require('../services/shopify.service');
const crypto = require('crypto');

let inventoryLogs = [];

const getWebhookHash = (payload) => {
    return crypto.createHash('md5').update(
        `${payload.inventory_item_id}-${payload.updated_at}`
    ).digest('hex');
};

const processedEvents = new Set();
exports.getHome = (req, res) => {
    let html = `<h1>🔗 Connect to Xero</h1>
    <a href="/xero/redirect"><button>Connect to Xero</button></a>
    <hr/><h1>📦 Shopify Inventory Updates</h1>`;

    if (inventoryLogs.length === 0) {
        html += `<p>No updates yet.</p>`;
    } else {
        html += `<ul>`;
        inventoryLogs.forEach((log, index) => {
            html += `<li><strong>${index + 1}:</strong> Inventory Item ID: ${log.inventory_item_id}, Available: ${log.available}, Updated At: ${log.updated_at}</li>`;
        });
        html += `</ul>`;
    }

    res.send(html);
};

exports.receiveWebhook = async (req, res) => {

    const topic = req.get('X-Shopify-Topic');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const isVerified = verifyHmac(req.body, hmacHeader);
    if (!isVerified) return res.status(401).send('Unauthorized');
    const payload = JSON.parse(req.body.toString('utf8'));
    console.log("topic: ", topic)
    // console.log("payload: ", payload)
    const hash = getWebhookHash(payload);
    if (processedEvents.has(hash)) {
        console.log('⚠️ Duplicate webhook received, skipping...');
        return;
    }
    processedEvents.add(hash);
    setTimeout(() => processedEvents.delete(hash), 10 * 60 * 1000);

    try {
        switch (topic) {
            case 'inventory_levels/update':
                console.log(payload)
                await shopifySyncService.syncInventoryFromShopify(payload);
                break;

            case 'orders/create':
                await shopifySyncService.syncOrderToXero(payload);
                break;
            case 'orders/cancelled':
            case 'orders/updated':
            case 'refunds/create':
            case 'products/update':
            case 'inventory_transfers/create':
                // Optional: just log or store for auditing
                console.log(`📦 Received ${topic}`, payload);
                break;

            default:
                console.log(`⚠️ Unhandled webhook topic: ${topic}`);
        }

        res.status(200).send('Received');
    } catch (err) {
        console.error("❌ Webhook Handling Error:", err);
        res.status(500).send('Error');
    }
};


