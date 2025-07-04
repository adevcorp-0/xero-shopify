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
const XERO_SKU_PREFIX = 'STX';


exports.ensureWebhookRegistered = async () => {
    const topic = "inventory_levels/update";
    const address = `${SHOPIFY_APP_SERVER}/webhook/inventory`;
    try {
        const existing = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`, {
            headers: SHOPIFY_HEADERS
        });
        const alreadyExists = existing.data.webhooks.some(
            (w) => w.address === address && w.topic === topic
        );
        if (alreadyExists) return console.log("✅ Webhook already registered.");
        const res = await axios.post(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/webhooks.json`, {
            webhook: { topic, address, format: "json" }
        }, {
            headers: SHOPIFY_HEADERS
        });

        console.log("✅ Webhook registered:", res.data);
    } catch (error) {
        console.error("❌ Shopify webhook error:", error.response?.data || error.message);
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

    while (true) {
        const params = { limit: 250 };
        if (since_id) params.since_id = since_id;

        const products = await shopifyClient.product.list(params);
        if (products.length === 0) break;

        for (const product of products) {
            allVariants.push(...product.variants);
        }

        since_id = products[products.length - 1].id;
    }
    // return allVariants;
    return allVariants[0];
}


exports.bulkSyncVariantsToXero = async function () {
    try {
        // const variants = await getAllShopifyVariants();
        let tmpVariants = [];
        const variants = await getAllShopifyVariants();
        tmpVariants.push(variants);
        for (const variant of tmpVariants) {
            try {
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
                const name = product?.title || variant.title || 'Unnamed';
                const description = product?.body_html || 'Imported from Shopify';
                const cleanDescription = striptags(description).slice(0, 4000);
                const salesPrice = parseFloat(variant.price) || 0;

                const costData = await getVariantCostByGraphQL(productId, inventory_item_id) || 0;
                const purchaseCost = parseFloat(costData) || 0;

                const xeroItem = await getXeroItemBySKU(uniqueCode);
                const purchaseDescription = `Imported: ${name}`;

                if (xeroItem) {
                    console.log(`✅ Already exists in Xero: ${uniqueCode}`);
                    continue;
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

                console.log('📦 Creating item in Xero:', uniqueCode);
                const createdItem = await createXeroItem(productData);
                console.log('🆕 Created:', createdItem?.Code);
                if (available > 0) {
                    const bill = await createXeroBillForItem({
                        code: uniqueCode,
                        quantity: available,
                        unitCost: purchaseCost,
                        description: purchaseDescription,
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

async function createXeroBillForItem({ code, quantity, unitCost, description }) {
    try {
        const today = new Date().toISOString().split('T')[0];
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { accessToken, tenantId } = await getValidAccessToken();
        console.log("Access TToken :", accessToken)
        console.log("Tenant :", tenantId)
        const payload = {
            Type: 'ACCPAY',
            Contact: { Name: 'Shopify Bulk Sync' },
            Date: today,
            DueDate: dueDate,
            LineItems: [{
                Description: description,
                Quantity: quantity,
                UnitAmount: unitCost,
                ItemCode: code,
                AccountCode: '1400',  // Inventory Asset account for increasing stock
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
