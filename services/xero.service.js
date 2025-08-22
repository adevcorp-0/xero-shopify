const axios = require('axios');
const { getValidAccessToken } = require('./xeroToken.service');
const { saveItemBill, getBillsForItem, removeBill } = require('../services/xeroItemBill.service');
const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN, SHOPIFY_APP_SERVER, XERO_TENANT_ID } = require('../config');
const BASE_URL = "https://api.xero.com/api.xro/2.0"

async function getXeroItemBySKU(code) {
    try {
        const { accessToken, tenantId } = await getValidAccessToken();
        const res = await axios.get(`${BASE_URL}/Items`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId
            },
            params: {
                where: `Code=="${code}"`
            }
        });

        return res.data.Items?.[0] || null;
    } catch (error) {
        console.error('❌ Error fetching item from Xero:', error.response?.data || error.message);
        throw error;
    }

}

async function updateXeroInventory(itemId, newQuantity) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const updatePayload = {
        Items: [
            {
                ItemID: itemId,
                InventoryQuantity: newQuantity
            }
        ]
    };
    const response = await axios.post('https://api.xero.com/api.xro/2.0/Items', updatePayload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            'Content-Type': 'application/json'
        }
    });
    return response.data;
}

async function createXeroItem(itemData) {
    try {
        const { accessToken, tenantId } = await getValidAccessToken();
        const response = await axios.post(`${BASE_URL}/Items`, {
            Items: [itemData]
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            }
        });

        return response.data.Items?.[0];
    } catch (err) {
        if (error.response?.data) {
            const xeroError = error.response.data;
            console.error('❌ Error creating item in Xero:', JSON.stringify(xeroError, null, 2));

            const validationErrors = xeroError.Elements?.[0]?.ValidationErrors;
            if (validationErrors?.length) {
                validationErrors.forEach(err =>
                    console.error(`🔺 Validation Error: ${err.Message}`)
                );
            }
        } else {
            console.error('❌ Unknown error:', error.message);
        }

    }
}

async function createABill() {
    const payload = {
        Type: 'ACCPAY',
        Contact: {
            Name: 'Sasa Milojevic',
            EmailAddress: 'w.mkl.corp@gmail.com'
        },
        Date: '2025-07-07',
        DueDate: '2025-08-06',
        LineItems: [
            {
                Description: 'Stock for T-Shirts',
                Quantity: 10,
                UnitAmount: 10,
                ItemCode: 'STX-TSHIRT-SM',
                AccountCode: '5000'
            }
        ],
        Reference: 'Restock Order #1001',
        Status: 'AUTHORISED'
    }
    try {
        const { accessToken, tenantId } = await getValidAccessToken();
        const response = await axios.post(
            'https://api.xero.com/api.xro/2.0/Invoices',
            { Invoices: [payload] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log("✅ Bill created successfully:", response.data);
        return response.data;
    } catch (error) {
        console.error("❌ Failed to create bill:", error.response?.data || error.message);
        throw error;
    }

}

async function getXeroItemQuantity(itemId) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const res = await axios.get(`${BASE_URL}/Items/${itemId}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json'
        }
    });
    return res.data?.Items?.[0]?.QuantityOnHand ?? 0;
}

async function createInventoryBill({ sku, quantity, unitCost }) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const billPayload = {
        Type: "ACCPAY",
        Contact: { Name: "Shopify Supplier" },
        Date: new Date().toISOString().split('T')[0],
        LineItems: [
            {
                Description: `Inventory sync from Shopify for ${sku}`,
                Quantity: quantity,
                UnitAmount: unitCost,
                AccountCode: "5000",
                ItemCode: sku
            }
        ],
        Status: "AUTHORISED"
    };

    await axios.post(`${BASE_URL}/Invoices`, { Invoices: [billPayload] }, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    });
}

async function archiveBillsForItem(itemCode) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const bills = await getBillsForItem(itemCode);

    for (const bill of bills) {
        try {
            await axios.post(`${BASE_URL}/Invoices/${bill.invoiceId}`, {
                Invoices: [{ InvoiceID: bill.invoiceId, Status: "VOIDED" }]
            }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            console.log(`✅ Voided bill ${bill.invoiceId} for item ${itemCode}`);
            await removeBill(bill.invoiceId); // Clean up mapping
        } catch (error) {
            console.error(`❌ Failed to void bill ${bill.invoiceId}:`, error.response?.data || error.message);
        }
    }
}

const getXeroInvoiceByReference = async (reference) => {
    const { accessToken, tenantId } = await getValidAccessToken();
    const whereClause = `Reference == "${reference}"`;
    const encodedWhere = encodeURIComponent(whereClause);

    const response = await axios.get(`${BASE_URL}/Invoices?where=${encodedWhere}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
        },
    });

    const invoices = response.data.Invoices || [];
    return invoices.length > 0 ? invoices[0] : null;
}

const createInvoice = async (invoicePayload) => {
    const { accessToken, tenantId } = await getValidAccessToken();
    const response = await axios.post(`${BASE_URL}/Invoices`, { Invoices: [invoicePayload] }, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        }
    });

    return response.data.Invoices?.[0];

}

async function createXeroPayment(invoiceId, amount) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const payload = {
        Payments: [
            {
                Invoice: { InvoiceID: invoiceId },
                Account: { Code: "5011" }, // Replace with your Xero bank/cash account code
                Date: new Date().toISOString().split('T')[0],
                Amount: amount
            }
        ]
    };
    const response = await axios.post(
        `${BASE_URL}/Payments`,
        payload,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            }
        }
    );
    return response.data.Payments?.[0];
}

const updateInvoice = async (invoiceId) => {
    const { accessToken, tenantId } = await getValidAccessToken();
    const updateRes = await axios.put(`${BASE_URL}/Invoices/${invoiceId}`, { Invoices: [{ InvoiceID: invoiceId, Status: 'VOIDED' }] },
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
                'Content-Type': 'application/json'
            }
        }
    );
    return updateRes;
}

const checkContact = async (contactId) => {
    try {
        const { accessToken, tenantId } = await getValidAccessToken();

        const response = await axios.get(
            `${BASE_URL}/Contacts/${contactId}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            }
        );

        return !!response?.data?.Contacts?.length;
    } catch (error) {
        // Contact not found or other error
        return false;
    }
}

const xeroRefundCreate = async (creditNotePayload) => {
    try {
        const { accessToken, tenantId } = await getValidAccessToken();
        const response = await axios.post(
            `${BASE_URL}/CreditNotes`,
            { CreditNotes: [creditNotePayload] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            }
        );
        console.log(`💸 Created credit note for refund on order ${orderName}`);
        return response.data;
    } catch (err) {
        console.log("❌ Error creating refund in Xero: ", err.response?.data || err.message);
    }
}
// Remove test orders
async function getInvoicesByContactEmail(email, fromDate) {
    const { accessToken, tenantId } = await getValidAccessToken();

    const whereClause = `Contact.EmailAddress=="${email}" AND Date>=DateTime(${fromDate})`;
    const encodedWhere = encodeURIComponent(whereClause);

    const response = await axios.get(`${BASE_URL}/Invoices?where=${encodedWhere}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            Accept: "application/json"
        }
    });

    return response.data.Invoices || [];
}

async function voidInvoice(invoiceId) {
    const { accessToken, tenantId } = await getValidAccessToken();

    const payload = {
        Invoices: [
            {
                InvoiceID: invoiceId,
                Status: "VOIDED"
            }
        ]
    };

    const response = await axios.post(`${BASE_URL}/Invoices`, payload, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            Accept: "application/json",
            "Content-Type": "application/json"
        }
    });

    return response.data.Invoices?.[0];
}

// async function voidInvoicesByContact(contactName, fromDate = "2025-06-01") {
//     console.log(`🔎 Searching for invoices for ${contactName} after ${fromDate}...`);

//     const invoices = await getInvoicesByContactEmail(contactName, fromDate);

//     if (invoices.length === 0) {
//         console.log("✅ No invoices found to void.");
//         return;
//     }

//     console.log(`📄 Found ${invoices.length} invoices. Voiding...`);

//     for (const inv of invoices) {
//         try {
//             const result = await voidInvoice(inv.InvoiceID);
//             console.log(`✅ Voided invoice ${inv.InvoiceNumber} (${inv.InvoiceID})`);
//         } catch (err) {
//             console.error(`❌ Failed to void invoice ${inv.InvoiceID}:`, err.response?.data || err.message);
//         }
//     }

//     console.log("🎉 Finished voiding invoices.");
// }
async function voidInvoicesByContactName(contactKeyword, afterDate) {
    const { accessToken, tenantId } = await getValidAccessToken();

    // 1️⃣ Fetch invoices after the date
    const response = await axios.get(
        `${BASE_URL}/Invoices?where=Date>=DateTime(${afterDate})`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Xero-tenant-id": tenantId,
                Accept: "application/json"
            }
        }
    );

    const invoices = response.data.Invoices || [];
    const matched = invoices.filter(inv => {
        const name = inv.Contact?.Name || "";
        const email = inv.Contact?.EmailAddress || "";
        return (
            name.toLowerCase().includes(contactKeyword.toLowerCase()) ||
            email.toLowerCase().includes(contactKeyword.toLowerCase())
        );
    });

    if (matched.length === 0) {
        console.log(`⚠️ No invoices found for contact "${contactKeyword}" after ${afterDate}`);
        return;
    }

    // 2️⃣ Loop invoices
    for (const inv of matched) {
        console.log(`\n📄 Checking Invoice ${inv.InvoiceNumber} | Status: ${inv.Status}`);

        if (inv.Status === "VOIDED") {
            console.log("✅ Already voided, skipping.");
            continue;
        }

        // 3️⃣ Handle payments if exist
        if (inv.Payments && inv.Payments.length > 0) {
            for (const pay of inv.Payments) {
                console.log(`💸 Deleting Payment ${pay.PaymentID} (${pay.Amount})`);
                await axios.post(
                    `${BASE_URL}/Payments`,
                    { Payments: [{ PaymentID: pay.PaymentID, Status: "DELETED" }] },
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Xero-tenant-id": tenantId,
                            Accept: "application/json",
                            "Content-Type": "application/json"
                        }
                    }
                );
            }
        }

        // 4️⃣ Now void invoice
        console.log(`🗑️ Voiding Invoice ${inv.InvoiceNumber}`);
        await axios.post(
            `${BASE_URL}/Invoices`,
            { Invoices: [{ InvoiceID: inv.InvoiceID, Status: "VOIDED" }] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Xero-tenant-id": tenantId,
                    Accept: "application/json",
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(`✅ Successfully voided Invoice ${inv.InvoiceNumber}`);
    }

}

async function listInvoicesAfter(date) {
    const { accessToken, tenantId } = await getValidAccessToken();
    const response = await axios.get(`${BASE_URL}/Invoices?where=Date>=DateTime(${date})`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
        },
    });

    const invoices = response.data.Invoices || [];
    console.log(`📑 Found ${invoices.length} invoices after ${date}`);
    invoices.forEach(inv => {
        console.log(`- Invoice ${inv.InvoiceNumber} | Status: ${inv.Status}`);
        console.log(`  Contact: ${inv.Contact?.Name} | Email: ${inv.Contact?.EmailAddress}`);
        console.log(`  Date: ${inv.Date} | Total: ${inv.Total}`);
    });
}

async function cleanTestInvoices(contactName, afterDate) {
    const invoices = await fetchXeroInvoices();

    const matched = invoices.filter(inv =>
        inv.Contact?.Name?.toLowerCase().includes(contactName.toLowerCase()) &&
        new Date(inv.DateString) >= new Date(afterDate)
    );

    console.log(`Found ${matched.length} invoices to clean.`);

    for (const inv of matched) {
        if (inv.CreditNotes && inv.CreditNotes.length > 0) {
            for (const cn of inv.CreditNotes) {
                console.log(`⚠️ Deleting Credit Note ${cn.CreditNoteNumber} linked to Invoice ${inv.InvoiceNumber}`);
                await axios.post(`${XERO_API}/CreditNotes/${cn.CreditNoteID}`, {
                    CreditNotes: [{ CreditNoteID: cn.CreditNoteID, Status: "VOIDED" }]
                }, { headers: { Authorization: `Bearer ${XERO_TOKEN}`, 'Xero-tenant-id': XERO_TENANT_ID, 'Content-Type': 'application/json' } });
            }
        }

        if (inv.Status !== "VOIDED") {
            console.log(`🗑️ Voiding Invoice ${inv.InvoiceNumber} | Contact: ${inv.Contact?.Name}`);
            await axios.post(`${XERO_API}/Invoices`, {
                Invoices: [{ InvoiceID: inv.InvoiceID, Status: "VOIDED" }]
            }, { headers: { Authorization: `Bearer ${XERO_TOKEN}`, 'Xero-tenant-id': XERO_TENANT_ID, 'Content-Type': 'application/json' } });
        }
    }

    console.log("✅ Clean-up finished.");
}

async function fetchXeroInvoices() {
    const { accessToken, tenantId } = await getValidAccessToken();
    const response = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json'
        }
    });

    return response.data.Invoices; // This is the list of invoices
}

async function voidCreditNotesByContact(contactName, afterDate) {
    const { accessToken, tenantId } = await getValidAccessToken();

    // 1️⃣ Fetch all credit notes
    let creditNotes = [];
    try {
        const response = await axios.get(`${BASE_URL}/CreditNotes`, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json'
            }
        });
        creditNotes = response.data.CreditNotes || [];
    } catch (err) {
        console.error('❌ Failed to fetch credit notes:', err.response?.data || err.message);
        return;
    }

    // 2️⃣ Filter by contact name and date
    const matched = creditNotes.filter(cn =>
        cn.Contact?.Name?.toLowerCase().includes(contactName.toLowerCase()) &&
        new Date(cn.DateString) >= new Date(afterDate)
    );

    if (matched.length === 0) {
        console.log(`⚠️ No credit notes found for contact "${contactName}" after ${afterDate}`);
        return;
    }

    console.log(`ℹ️ Found ${matched.length} credit notes for voiding.`);

    // Helper to void a credit note
    async function voidCreditNote(cn) {
        try {
            await axios.post(`${BASE_URL}/CreditNotes`, {
                CreditNotes: [{ CreditNoteID: cn.CreditNoteID, Status: "VOIDED" }]
            }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ Voided Credit Note ${cn.CreditNoteNumber}`);
        } catch (err) {
            console.error(`❌ Failed to void Credit Note ${cn.CreditNoteNumber}:`, err.response?.data || err.message);
        }
    }

    // 3️⃣ Process each matched credit note
    for (const cn of matched) {
        console.log(`🔹 Processing Credit Note ${cn.CreditNoteNumber} | Status: ${cn.Status}`);

        if (cn.Status === "PAID") {
            // 1️⃣ Unapply all payments first
            for (const allocation of cn.Allocations || []) {
                try {
                    await axios.post(`${BASE_URL}/Payments/${allocation.PaymentID}/Delete`, {}, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Xero-tenant-id': tenantId,
                            Accept: 'application/json',
                            'Content-Type': 'application/json'
                        }
                    });
                    console.log(`🗑️ Unapplied Payment ${allocation.PaymentID}`);
                } catch (err) {
                    console.error(`❌ Failed to unapply Payment ${allocation.PaymentID}:`, err.response?.data || err.message);
                }
            }

            // 2️⃣ Refresh credit note status after unapplied payments
            try {
                const res = await axios.get(`${BASE_URL}/CreditNotes/${cn.CreditNoteID}`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Xero-tenant-id': tenantId,
                        Accept: 'application/json'
                    }
                });
                cn.Status = res.data.CreditNotes[0].Status;
            } catch (err) {
                console.error(`❌ Failed to refresh Credit Note ${cn.CreditNoteNumber}:`, err.response?.data || err.message);
            }
        }

        // 3️⃣ Now void the credit note if not already voided
        if (cn.Status !== "VOIDED") {
            console.log(`🗑️ Voiding Credit Note ${cn.CreditNoteNumber} | Contact: ${cn.Contact?.Name}`);
            await voidCreditNote(cn);
        } else {
            console.log(`ℹ️ Credit Note ${cn.CreditNoteNumber} is already VOIDED.`);
        }
    }

    console.log(`🎉 Finished processing credit notes for "${contactName}".`);
}

async function getNewShopifyOrders() {
    try {
        const response = await axios.get(`${SHOPIFY_STORE_DOMAIN}/orders.json?status=any`, {
            headers: {
                'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
                Accept: 'application/json'
            }
        });
        return response.data.orders || [];
    } catch (err) {
        console.error('❌ Failed to fetch Shopify orders:', err.message);
        return [];
    }
}

async function processOrderInXero(order) {
    const { accessToken, tenantId } = await getValidAccessToken();

    // Example: Create an invoice in Xero
    const invoiceData = {
        Invoices: [
            {
                Type: 'ACCREC',
                Contact: { Name: order.customer?.first_name + ' ' + order.customer?.last_name || 'Unknown' },
                Date: order.created_at,
                DueDate: order.created_at,
                LineItems: order.line_items.map(item => ({
                    Description: item.title,
                    Quantity: item.quantity,
                    UnitAmount: parseFloat(item.price),
                    AccountCode: '200' // Replace with your Xero account code
                })),
                Status: 'AUTHORISED'
            }
        ]
    };

    await axios.post(`${BASE_URL}/Invoices`, invoiceData, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        }
    });

    console.log(`✅ Created invoice in Xero for Shopify Order ${order.id}`);
}



module.exports = {
    getXeroItemBySKU,
    updateXeroInventory,
    createXeroItem,
    createABill,
    getXeroInvoiceByReference,
    createInvoice,
    updateInvoice,
    checkContact,
    xeroRefundCreate,
    getXeroItemQuantity,
    createInventoryBill,
    archiveBillsForItem,
    xeroRefundCreate,
    createXeroPayment,

    getInvoicesByContactEmail,
    voidInvoice,
    voidInvoicesByContactName,
    listInvoicesAfter,
    cleanTestInvoices,
    voidCreditNotesByContact

}