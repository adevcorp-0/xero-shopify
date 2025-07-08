const axios = require('axios');
const striptags = require('striptags');
const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_APP_SERVER, XERO_TENANT_ID } = require('../config');
const { getXeroItemBySKU, updateXeroInventory, createXeroItem } = require('./xero.service');
const shopifyClient = require('../utils/shopifyClient');
const { getValidAccessToken } = require('./xeroToken.service');
const BASE_URL = "https://api.xero.com/api.xro/2.0"

const SHOPIFY_HEADERS = {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
};
const XERO_SKU_PREFIX = 'STOX';


exports.ensureWebhookRegistered = async () => {
    const topics = [
        { topic: "inventory_levels/update", path: "/webhook/inventory" },
        { topic: "orders/create", path: "/webhook/inventory/orders" },
        // Add more as needed (orders/updated, orders/cancelled, etc.)
    ];
    try {
        const existingRes = await axios.get(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`,
            { headers: SHOPIFY_HEADERS }
        );
        const existing = existingRes.data.webhooks || [];
        for (const { topic, path } of topics) {
            const address = `${SHOPIFY_APP_SERVER}${path}`;
            const alreadyExists = existing.some(
                (w) => w.address === address && w.topic === topic
            );
            if (alreadyExists) {
                console.log(`✅ Webhook already registered: ${topic}`);
                continue;
            }
            const res = await axios.post(
                `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`,
                {
                    webhook: {
                        topic,
                        address,
                        format: "json"
                    }
                },
                { headers: SHOPIFY_HEADERS }
            );
            console.log(`✅ Registered webhook for: ${topic}`, res.data?.webhook?.id || '');
        }
    } catch (error) {
        console.error("❌ Error registering webhooks:", error.response?.data || error.message);
    }
};

exports.clearAllWebhooks = async () => {
    try {
        const res = await axios.get(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`,
            { headers: SHOPIFY_HEADERS }
        );

        const webhooks = res.data.webhooks || [];

        for (const webhook of webhooks) {
            await axios.delete(
                `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks/${webhook.id}.json`,
                { headers: SHOPIFY_HEADERS }
            );
            console.log(`🗑️ Deleted webhook: ${webhook.topic} → ${webhook.address}`);
        }

        console.log("✅ All webhooks deleted.");
    } catch (error) {
        console.error("❌ Error deleting webhooks:", error.response?.data || error.message);
    }
};

exports.syncInventoryFromShopify = async (payload) => {
    try {
        const { inventory_item_id, available } = payload;
        const variant = await getVariantByInventoryItemId(inventory_item_id);
        if (!variant || !variant.sku) {
            console.warn('⚠️ SKU not found for inventory_item_id:', inventory_item_id);
            return;
        }
        const productId = extractIdFromGid(variant.product.id);
        const product = await getProductById(productId);

        const sku = variant.sku;
        const uniqueCode = `${XERO_SKU_PREFIX}-${sku}`;

        const name = product?.title || variant.title || 'Unnamed';
        const description = product?.body_html || 'Imported from Shopify';
        const cleanDescription = striptags(description).slice(0, 4000);
        const salesPrice = parseFloat(variant.price) || 0;
        // const purchaseCost = salesPrice * 0.5;

        // const purchaseCost = await getVariantCostByGraphQL(productId) || 0;
        const costData = await getVariantCostByGraphQL(productId, inventory_item_id) || 0;
        const purchaseCost = parseFloat(costData) || 0;

        const xeroItem = await getXeroItemBySKU(uniqueCode);
        const purchaseDescription = `Imported: ${name}`
        if (xeroItem) {
            console.log("Item already exist : ", xeroItem);
            // const updateRes = await updateXeroInventory(xeroItem.ItemID, available);
            // console.log("Update Xero Item Result : ", updateRes);
        } else {
            const productData = {
                Code: uniqueCode,
                Name: name,
                Description: cleanDescription,
                QuantityOnHand: Number(available),
                IsTrackedAsInventory: true,
                InventoryAssetAccountCode: '1400',

                PurchaseDescription: purchaseDescription,
                PurchaseDetails: {
                    UnitPrice: purchaseCost,
                    COGSAccountCode: '5000',
                    TaxType: 'NONE',
                },

                SalesDetails: {
                    UnitPrice: salesPrice,
                    AccountCode: '4000',
                    TaxType: 'NONE',
                },
                IsSold: true,
                IsPurchased: true,
            };
            console.log("product data : ", productData);
            const createdItem = await createXeroItem(productData);
            console.log('🆕 Created Xero item:', createdItem?.Code || sku);
        }
    } catch (error) {
        console.error('❌ Error syncing inventory to Xero:', error.message || error);
    }
};

exports.syncOrderToXero = async (orderPayload) => {
    try {
        const { id, line_items, customer } = orderPayload;
        if (!line_items || line_items.length === 0) {
            console.warn('⚠️ No line items found in order:', id);
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const { accessToken, tenantId } = await getValidAccessToken();
        const contactName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer';

        const lineItems = line_items.map(item => ({
            Description: item.title,
            Quantity: item.quantity,
            UnitAmount: parseFloat(item.price),
            ItemCode: `${XERO_SKU_PREFIX}-${item.sku}`,
            AccountCode: '4000', // Sales account
        }));

        const payload = {
            Type: 'ACCREC',
            Contact: { Name: contactName },
            Date: today,
            DueDate: dueDate,
            LineItems: lineItems,
            Reference: orderPayload.name,
            Status: 'AUTHORISED',
        };

        console.log('📦 Order payload being sent to Xero:', JSON.stringify(payload, null, 2));
        // return;

        const response = await axios.post(`${BASE_URL}/Invoices`, { Invoices: [payload] }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log(`🧾 Created Xero invoice for order ${id}:`, response.data.Invoices?.[0]?.InvoiceID);
    } catch (error) {
        if (error.response?.data) {
            console.error("❌ Xero Detailed Error:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Unknown Error:", error.message);
        }
    }
}

async function getVariantByInventoryItemId(inventoryItemId) {
    const query = `
    query ($inventoryItemId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        id
        variant {
          id
          sku
          title
          price
          product {
            id
            title
            bodyHtml
          }
        }
      }
    }
  `;
    const inventoryItemGID = `gid://shopify/InventoryItem/${inventoryItemId}`;

    const response = await axios.post(
        `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/graphql.json`,
        { query, variables: { inventoryItemId: inventoryItemGID } },
        { headers: SHOPIFY_HEADERS }
    );

    const variant = response.data.data?.inventoryItem?.variant;
    return variant || null;
};

async function getProductById(productId) {
    try {
        const res = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/products/${productId}.json`, {
            headers: SHOPIFY_HEADERS,
        });

        return res.data.product || null;
    } catch (err) {
        console.error(`❌ Failed to fetch product ${productId}:`, err.message);
        return null;
    }
};

async function getVariantCostByGraphQL(productId, inventoryItemId) {
    const query = `
    query getProductCost($productId: ID!) {
      product(id: $productId) {
        variants(first: 100) {
          nodes {
            id
            sku
            inventoryItem {
              id
              unitCost {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;

    const variables = {
        productId: `gid://shopify/Product/${productId}`,
    };
    try {
        const response = await axios.post(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-04/graphql.json`,
            { query, variables },
            {
                headers: SHOPIFY_HEADERS
            }
        );

        const variants = response.data.data?.product?.variants?.nodes || [];

        const matching = variants.find(
            v => v.inventoryItem?.id === `gid://shopify/InventoryItem/${inventoryItemId}`
        );
        return matching?.inventoryItem?.unitCost?.amount || 0;
    }
    catch (error) {
        console.error('Error fetching variant cost:', error.message);
        return "0";
    }
}


function extractIdFromGid(gid) {
    return gid.split('/').pop();
}


// Bulk Synchronization
async function getAllShopifyVariants() {
    let since_id = null;
    let allVariants = [];
    let seenProductIds = new Set();

    while (true) {
        const params = { limit: 250 };
        if (since_id) params.since_id = since_id;
        const products = await shopifyClient.product.list(params);
        if (products.length === 0) break;
        const lastId = products[products.length - 1].id;
        if (seenProductIds.has(lastId)) {
            console.warn("🛑 Detected potential infinite loop at product ID:", lastId);
            break;
        }
        for (const product of products) {
            seenProductIds.add(product.id);
            allVariants.push(...product.variants);
        }
        since_id = lastId;
    }
    return allVariants;
}


exports.bulkSyncVariantsToXero = async function () {
    try {
        // const variants = await getAllShopifyVariants();
        let tmpVariants = [];
        const variants = await getAllShopifyVariants();
        let tmp = 1;
        // tmpVariants.push(variants);
        for (const variant of variants) {
            try {
                console.log("====", tmp, "======");
                tmp++;
                const inventory_item_id = variant.inventory_item_id;
                const available = variant.inventory_quantity || 0;

                const productId = variant.product_id;
                const product = await getProductById(productId);

                const sku = variant.sku;
                if (!sku) {
                    console.warn('⚠️ Missing SKU for variant:', variant.id);
                    continue;
                }

                const uniqueCode = `${XERO_SKU_PREFIX}-${sku}`;
                // const name = product?.title || variant.title || 'Unnamed';
                const name = product?.title + ' ' + variant.title || 'Unnamed';
                const description = product?.body_html || 'Imported from Shopify';
                const cleanDescription = striptags(description).slice(0, 4000);
                const salesPrice = parseFloat(variant.price) || 0;

                const costData = await getVariantCostByGraphQL(productId, inventory_item_id) || 0;
                const purchaseCost = parseFloat(costData) || 0;

                const xeroItem = await getXeroItemBySKU(uniqueCode);
                const purchaseDescription = `Imported: ${name}`;

                if (xeroItem) {
                    console.log(`✅ Already exists in Xero: ${uniqueCode}`);
                    // continue;
                }
                const productData = {
                    Code: uniqueCode,
                    Name: name,
                    Description: cleanDescription,
                    QuantityOnHand: Number(available),
                    IsTrackedAsInventory: true,
                    InventoryAssetAccountCode: '1400',
                    PurchaseDescription: purchaseDescription,
                    PurchaseDetails: {
                        UnitPrice: purchaseCost,
                        COGSAccountCode: '5000',
                        TaxType: 'NONE',
                    },
                    SalesDetails: {
                        UnitPrice: salesPrice,
                        AccountCode: '4000',
                        TaxType: 'NONE',
                    },
                    IsSold: true,
                    IsPurchased: true,
                };
                let reference = `Shopify Bulk Sync to Xero - ${name}`
                console.log('📦 Creating item in Xero:', uniqueCode);
                const createdItem = await createXeroItem(productData);
                console.log('🆕 Created:', createdItem?.Code);
                if (available > 0) {
                    const bill = await createXeroBillForItem({
                        code: uniqueCode,
                        quantity: available,
                        unitCost: purchaseCost,
                        description: purchaseDescription,
                        reference: reference
                    });
                    console.log(`🧾 Created bill for new item ${uniqueCode}: Bill ID ${bill.InvoiceID}`);
                }


            } catch (innerErr) {
                console.error('❌ Error syncing variant:', variant?.id, innerErr?.response?.body || innerErr.message);
            }
        }
    } catch (err) {
        console.error('❌ Failed to sync variants on startup:', err);
    }

}

async function createXeroBillForItem({ code, quantity, unitCost, description, reference }) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { accessToken, tenantId } = await getValidAccessToken();
        const payload = {
            Type: 'ACCPAY',
            Contact: { Name: 'Shopify Bulk Sync' },
            Date: today,
            DueDate: dueDate,
            Reference: reference,
            LineItems: [{
                Description: description,
                Quantity: quantity,
                UnitAmount: unitCost,
                ItemCode: code,
                AccountCode: '1400',
            }],
            Status: 'AUTHORISED',
        };
        console.log("Tenant Before", tenantId)
        const response = await axios.post(`${BASE_URL}/Invoices`,
            { Invoices: [payload] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            });

        console.log("Tenant After", tenantId)

        return response.data.Invoices?.[0];
    } catch (error) {
        console.error('❌ Error creating bill in Xero:', JSON.stringify(error.response.data, null, 2));
    }
}
