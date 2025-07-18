const axios = require('axios');
const { getValidAccessToken } = require('./xeroToken.service');
const { saveItemBill, getBillsForItem, removeBill } = require('../services/xeroItemBill.service');
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
};

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
};


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
};

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
};

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
    archiveBillsForItem
};
