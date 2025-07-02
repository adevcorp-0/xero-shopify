const axios = require('axios');
const striptags = require('striptags');
const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_APP_SERVER } = require('../config');
const { getXeroItemBySKU, updateXeroInventory, createXeroItem } = require('./xero.service');

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

        const purchaseCost = await getVariantCostByGraphQL(variant.id) || 0;
        // console.log(purchaseCost)
        // return;
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
                QuantityOnHand: available,
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

// async function getVariantByInventoryItemId(inventoryItemId) {
//     try {
//         const res = await axios.get(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/variants.json?inventory_item_ids=${inventoryItemId}`, {
//             headers: SHOPIFY_HEADERS
//         });

//         return res.data.variants[0] || null;
//     } catch (err) {
//         console.error(`❌ Failed to fetch variant for inventory_item_id ${inventoryItemId}:`, err.message);
//         return null;
//     }
// };
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

// async function getVariantCostByGraphQL(variantId) {
//     // try {
//         // 1. Get inventory item ID from variant
//         const variantRes = await axios.get(
//             `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/variants/${variantId}.json`,
//             { headers: SHOPIFY_HEADERS }
//         );

//         const inventoryItemId = variantRes.data.variant.inventory_item_id;

//         // 2. Get inventory item to fetch cost
//         const inventoryRes = await axios.get(
//             `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2023-10/inventory_items/${inventoryItemId}.json`,
//             { headers: SHOPIFY_HEADERS }
//         );
//         console.log(inventoryRes.data)
//         const cost = inventoryRes.data.inventory_item.cost;
//         return cost || 0;
//     // } catch (err) {
//     //     console.error("Error fetching cost via REST:", err.response?.data || err.message);
//     //     return 0;
//     // }

// }
async function getVariantCostByGraphQL(variantId) {
    const query = `
    query getProductVariantsUnitCost($id: ID!) {
      product(id: $id) {
        variants(first: 10) {
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

    try {
        const response = await axios.post(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json`,
            { query, variables: { id: variantId } },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                },
            }
        );

        if (response.data.errors) {
            console.error('GraphQL errors:', response.data.errors);
            throw new Error('Failed to fetch variant cost');
        }

        const cost = response.data.data?.productVariant?.inventoryItem?.cost;

        return cost ?? "0";
    } catch (error) {
        console.error('Error fetching variant cost:', error.message);
        return "0";
    }
}

function extractIdFromGid(gid) {
    return gid.split('/').pop();
}
