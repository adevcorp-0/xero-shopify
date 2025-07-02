const { verifyHmac } = require('../utils/hmac.util');
const { getValidAccessToken } = require('../services/xeroToken.service');
const shopifySyncService = require('../services/shopify.service');

let inventoryLogs = [];

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
    console.log("payload: ", payload)
    try {
        switch (topic) {
            case 'inventory_levels/update':
                console.log(payload)
                await shopifySyncService.syncInventoryFromShopify(payload);
                break;

            case 'orders/create':
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


