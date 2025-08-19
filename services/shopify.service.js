const axios = require('axios');
const striptags = require('striptags');
const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_APP_SERVER, XERO_TENANT_ID } = require('../config');
const { getXeroItemBySKU, updateXeroInventory, createXeroItem, getXeroInvoiceByReference, createInvoice, updateInvoice, checkContact, getXeroItemQuantity, createInventoryBill, archiveBillsForItem, xeroRefundCreate, createXeroPayment } = require('./xero.service');
const { saveItemBill, getBillsForItem, removeBill } = require('../services/xeroItemBill.service');

const shopifyClient = require('../utils/shopifyClient');
const { getValidAccessToken } = require('./xeroToken.service');
const inventoryExpectationService = require('../services/inventoryExpectation.service');
const BASE_URL = "https://api.xero.com/api.xro/2.0"

const SHOPIFY_HEADERS = {
    "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
    "Content-Type": "application/json"
};
const XERO_SKU_PREFIX = 'SPY-XRO';

exports.ensureWebhookRegistered = async () => {
    const topics = [
        { topic: "inventory_levels/update", path: "/webhook/inventory" },
        // { topic: "orders/create", path: "/webhook/inventory/orders" },
        { topic: "orders/paid", path: "/webhook/inventory/orders" },
        { topic: "orders/cancelled", path: "/webhook/inventory/orders" },
        { topic: "orders/updated", path: "/webhook/inventory/orders" },
        { topic: "refunds/create", path: "/webhook/inventory/orders" },
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
        const { inventory_item_id, location_id, available } = payload;
        const variant = await getVariantByInventoryItemId(inventory_item_id);
        if (!variant || !variant.sku) {
            console.warn('⚠️ SKU not found for inventory_item_id:', inventory_item_id);
            return;
        }

        const isExpected = await inventoryExpectationService.isExpectedInventoryChange({
            inventoryItemId: inventory_item_id,
            locationId: location_id,
            actualQuantity: available
        });
        console.log(isExpected);
        if (isExpected.matched) {
            console.log(`✅ Skipped expected inventory update for item ${inventory_item_id}`);
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
            const xeroQty = await getXeroItemQuantity(xeroItem.ItemID);
            const diff = Number(available) - Number(xeroQty);
            let reference = `Shopify Bulk Sync to Xero - ${name}`
            if (diff > 0) {
                const bill = await createXeroBillForItem({
                    code: uniqueCode,
                    quantity: diff,
                    unitCost: purchaseCost,
                    description: purchaseDescription,
                    reference: reference
                });
                console.log(`🧾 Created bill (********* Manual increase **************) for new item ${uniqueCode}: Bill ID ${bill.InvoiceID}`);
            }
            // else if (diff < 0) {
            //     await archiveBillsForItem(uniqueCode);
            //     const bill = await createXeroBillForItem({
            //         code: uniqueCode,
            //         quantity: available,
            //         unitCost: purchaseCost,
            //         description: purchaseDescription,
            //         reference: reference
            //     });
            //     console.log(`🧾 Created bill (********* Manual decrease **************) for new item ${uniqueCode}: Bill ID ${bill.InvoiceID}`);
            // } else {
            //     console.log(`✅ Inventory is already synced for SKU ${sku}`);
            // }
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
    console.log(`💳 Starting Xero sync for Shopify order: ${orderPayload.name}`);
    try {
        const { id, line_items, customer, name, location_id, shipping_lines } = orderPayload;
        if (!line_items || line_items.length === 0) {
            console.warn('⚠️ No line items found in order:', id);
            return;
        }

        const reference = name;
        const existingInvoice = await getXeroInvoiceByReference(reference);
        if (existingInvoice) {
            console.log(`⚠️ Invoice already exists in Xero for Shopify order ${reference}`);
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const dueDate = today;
        const contactName = customer ? `${customer.first_name} ${customer.last_name}` : 'Unknown Customer';
        const lineItems = line_items.map(item => {
            const price = parseFloat(item.price || '0');
            const quantity = parseInt(item.quantity || 1);
            const totalDiscount = parseFloat(item.total_discount || '0');

            const originalTotal = price * quantity;
            const netTotal = originalTotal - totalDiscount;
            const actualUnitPrice = parseFloat((netTotal / quantity).toFixed(2));

            return {
                Description: item.title,
                Quantity: quantity,
                UnitAmount: actualUnitPrice,
                ItemCode: `${XERO_SKU_PREFIX}-${item.sku}`,
                AccountCode: '4000',
            }
        });

        if (shipping_lines && shipping_lines.length > 0) {
            shipping_lines.forEach(shipping => {
                lineItems.push({
                    Description: shipping.title || 'Shipping',
                    Quantity: shipping.quantity || 1,
                    UnitAmount: parseFloat(shipping.price),
                    AccountCode: '6160',
                    TaxType: 'NONE'
                });
            });
        }
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
        const invoice = await createInvoice(payload);
        console.log(`🧾 Created Xero invoice for order ${id}:`, invoice?.InvoiceID);

        if (invoice?.InvoiceID) {
            const totalAmount = invoice.Total || invoice.AmountDue || 0;
            if (totalAmount > 0) {
                const payment = await createXeroPayment(invoice.InvoiceID, totalAmount);
                console.log(`💸 Marked invoice as paid in Xero: Payment ID ${payment?.PaymentID}`);
            }
        }
    } catch (error) {
        if (error.response?.data) {
            console.error("❌ Xero Detailed Error:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("❌ Unknown Error:", error.message);
        }
    }
}

exports.syncOrderUpdated = async (order) => {
    const reference = order.name;
    const existingInvoice = await getXeroInvoiceByReference(reference);
    if (existingInvoice) {
        console.log(`⚠️ Invoice already exists in Xero for Shopify order ${reference}`);
        return;
    }
    const invoiceId = existingInvoice.InvoiceID;
    await updateInvoice(invoiceId);
    const updatedLineItems = order.line_items.map(item => {
        const totalDiscount = parseFloat(item.total_discount || 0);
        const originalTotal = parseFloat(item.price) * item.quantity;
        const netTotal = originalTotal - totalDiscount;
        const actualUnitPrice = parseFloat((netTotal / item.quantity).toFixed(2));

        return {
            Description: item.title,
            Quantity: item.quantity,
            UnitAmount: actualUnitPrice,
            ItemCode: `${XERO_SKU_PREFIX}-${item.sku}`,
            AccountCode: '4000'
        };
    });

    const contact = order.customer
        ? { Name: `${order.customer.first_name} ${order.customer.last_name}` }
        : { Name: 'Unknown Customer' };
    const payload = {
        Type: 'ACCREC',
        Contact: contact,
        Date: new Date().toISOString().split('T')[0],
        DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        LineItems: updatedLineItems,
        Reference: reference,
        Status: 'AUTHORISED'
    };

    const invoice = await createInvoice(payload);
    console.log(`🧾 Created Xero invoice for order ${reference}:`, invoice?.InvoiceID);
}

exports.syncOrderCancelled = async (payload) => {
    const orderName = payload.name;
    console.log(`🗑️ Order cancelled: ${orderName}`);
    const invoice = await getXeroInvoiceByReference(orderName);
    if (!invoice) {
        console.warn(`❌ === Cancel Order === No invoice found: ${orderName}`);
        return;
    }
    if (invoice.Status === 'AUTHORISED' || invoice.Status === 'PAID') {
        const updateRes = await updateInvoice(invoice.InvoiceID);
        console.log(`🗑️ Voided invoice for canceled order: ${orderName}`);
    }
}

exports.syncRefundToXero = async (payload) => {
    try {
        const orderId = payload.order_id;
        const orderName = await getShopifyOrderName(orderId);
        if (orderName === null) {
            console.log("Order doesn't exist");
            return;
        }
        console.log("Refund order info: ", payload);
        const refund = payload;
        const invoice = await getXeroInvoiceByReference(orderName);
        if (!invoice) {
            console.warn(`❌ Invoice not found for refund: ${orderName}`);
            return;
        }
        const lineItems = refund.refund_line_items.map(item => ({
            Description: item.line_item.title,
            Quantity: item.quantity,
            UnitAmount: parseFloat(item.line_item.price),
            AccountCode: '4000',
            ItemCode: `${XERO_SKU_PREFIX}-${item.line_item.sku}`,
        }));

        let contact;
        if (invoice.Contact?.ContactID && await checkContact(invoice.Contact.ContactID)) {
            contact = { ContactID: invoice.Contact.ContactID };
        } else {
            contact = { Name: invoice.Contact?.Name || 'Unknown Customer' };
        }
        const creditNotePayload = {
            Type: 'ACCRECCREDIT',
            Contact: { ContactID: contact },
            Date: new Date().toISOString().split('T')[0],
            LineItems: lineItems,
            InvoiceID: invoice.InvoiceID,
            Status: 'AUTHORISED',
        };
        const result = await xeroRefundCreate(creditNotePayload);
        console.log(`🧾 Created credit note for refund on order ${orderName}:`, result?.CreditNoteID);
        return result;
    } catch (error) {
        console.error("❌ Error creating credit note:", error.response?.data || error.message);
    }



    const creditNotePayload = {
        Type: 'ACCRECCREDIT',
        Contact: { ContactID: contact },
        Date: new Date().toISOString().split('T')[0],
        LineItems: lineItems,
        InvoiceID: invoice.InvoiceID,
        Status: 'AUTHORISED',
    };
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

async function getShopifyOrderName(orderId) {
    try {
        const response = await axios.get(
            `https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-04/orders/${orderId}.json`,
            { headers: SHOPIFY_HEADERS }
        );
        return response.data.order?.name || null;
    } catch (error) {
        console.error(`❌ Failed to fetch Shopify order name for orderId ${orderId}:`, error.message);
        return null;
    }
}

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
                let reference = `ShopifyToXero_${uniqueCode}`
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
                    if (bill?.InvoiceID) {
                        await saveItemBill({
                            itemCode: uniqueCode,
                            invoiceId: bill.InvoiceID,
                            quantity: available,
                            reference: bill.Reference,
                        });
                        console.log(`🧾 Created bill for new item ${uniqueCode}: Bill ID ${bill.InvoiceID}`);
                    } else {
                        console.warn(`⚠️ Bill missing or invalid for ${uniqueCode}, skipping saveItemBill`);
                    }
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

        console.log("create bill info: ", code, quantity, unitCost, description, reference)
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