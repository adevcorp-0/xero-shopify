const { verifyHmac } = require('../utils/hmac.util');
const { getValidAccessToken } = require('../services/xeroToken.service');
const shopifySyncService = require('../services/shopify.service');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const LOG_FILE = path.join(__dirname, '../logs/webhook.log');

let inventoryLogs = [];
const processedEvents = new Map();
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

async function logWebhook(message, payload) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] ${message}`;
    if (payload) {
        logMessage += ` | Payload: ${JSON.stringify(payload)}`;
    }
    logMessage += '\n';

    try {
        await fs.appendFile(LOG_FILE, logMessage);
    } catch (err) {
        console.error('❌ Failed to write log:', err);
    }

}

const getWebhookHash = (topic, payload) => {
    if (topic.startsWith('orders/')) {
        return crypto.createHash('md5').update(
            `${payload.id || payload.order_id || payload.name}-${payload.created_at || payload.updated_at}`
        ).digest('hex');
    }
    return crypto.createHash('md5').update(
        `${payload.inventory_item_id}-${payload.updated_at}`
    ).digest('hex');
};

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

    try {
        const isVerified = verifyHmac(req.body, hmacHeader);
        if (!isVerified) {
            await logWebhook('❌ Unauthorized webhook received', { topic });
            return res.status(401).send('Unauthorized');
        }
        const payload = JSON.parse(req.body.toString('utf8'));
        const hash = getWebhookHash(topic, payload);
        const lastProcessed = processedEvents.get(hash);
        if (lastProcessed && Date.now() - lastProcessed < DUPLICATE_WINDOW_MS) {
            await logWebhook('⚠️ Duplicate webhook skipped', { topic, hash });
            return res.status(200).send('Duplicate webhook skipped');
        }
        processedEvents.set(hash, Date.now());
        await logWebhook(`📥 Received webhook: ${topic}`, payload);

        // if (processedEvents.has(hash)) {
        //     let info = `⚠️ Duplicate webhook received,  Topic: ${topic}`;
        //     if (payload.id) info += ` | Order ID: ${payload.id}`;
        //     if (payload.order_id) info += ` | Order ID: ${payload.order_id}`;
        //     if (payload.name) info += ` | Order Name: ${payload.name}`;
        //     if (payload.line_items && payload.line_items.length > 0) {
        //         const productNames = payload.line_items.map(li => li.title).join(', ');
        //         info += ` | Products: ${productNames}`;
        //     }
        //     console.log(info);
        //     return res.status(200).send(info);
        // }
        // processedEvents.add(hash);
        // setTimeout(() => processedEvents.delete(hash), 10 * 60 * 1000);

        switch (topic) {
            case 'inventory_levels/update':
                console.log(payload)
                await shopifySyncService.syncInventoryFromShopify(payload);
                break;
            // case 'orders/create':
            //     await shopifySyncService.syncOrderToXero(payload);
            //     break;
            case 'orders/paid':
                await logOrdersPaid(payload, 'Received orders/paid webhook');
                await shopifySyncService.syncOrderToXero(payload);
                await logOrdersPaid(payload, 'Finished processing orders/paid webhook');
                break;
            case 'orders/cancelled':
                await shopifySyncService.syncOrderCancelled(payload);
                break;
            // case 'orders/updated':
            //     console.log("====== Orders Updated Case =======")
            //     console.log(payload)
            //     break;
            case 'refunds/create':
                await shopifySyncService.syncRefundToXero(payload);
                break;
            // case 'products/update':
            // case 'inventory_transfers/create':
            //     // Optional: just log or store for auditing
            //     console.log(`📦 Received ${topic}`, payload);
            //     break;

            default:
                console.log(`⚠️ Unhandled webhook topic: ${topic}`);
        }

        res.status(200).send('Received');
    } catch (err) {
        console.error("❌ Webhook Handling Error:", err);
        res.status(500).send('Error');
    }
};

async function logOrdersPaid(payload, message = '') {
    const logDir = path.join(__dirname, '../logs');
    try {
        await fs.mkdir(logDir, { recursive: true }); // creates if not exists
        const logFile = path.join(logDir, 'orders_paid.log');
        const logEntry = `
            ==========================
            Time: ${new Date().toISOString()}
            Message: ${message}
            Payload: ${JSON.stringify(payload, null, 2)}
            ==========================
            `;
        await fs.appendFile(logFile, logEntry, 'utf8');
    } catch (err) {
        console.error('❌ Logging failed:', err);
    }
}

