const axios = require('axios');
const { getValidAccessToken } = require('./xeroToken.service');
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
                AccountCode: '5000' // Must be a valid "Direct Costs"/"Purchases" account
            }
        ],
        Reference: 'Restock Order #1001',
        Status: 'AUTHORISED'
    }
    // console.log(payload);
    // return;
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

module.exports = {
    getXeroItemBySKU,
    updateXeroInventory,
    createXeroItem,
    createABill
};
