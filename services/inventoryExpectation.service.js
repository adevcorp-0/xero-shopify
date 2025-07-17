const InventoryExpectation = require('../models/inventoryExpectation.model');

exports.logExpectedInventoryChange = async ({ sku, locationId, expectedQty, reason }) => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    return await InventoryExpectation.create({
        sku,
        location_id: locationId,
        expected_quantity: expectedQty,
        reason,
        expiresAt
    });
};

exports.isExpectedInventoryChange = async ({ sku, locationId, available }) => {
    const match = await InventoryExpectation.findOne({
        sku,
        location_id: locationId,
        expected_quantity: available
    });

    console.log("=== Match ==== ", match);

    if (match) {
        await InventoryExpectation.deleteOne({ _id: match._id }); // Clean up after match
        return { matched: true, reason: match.reason };
    }

    return { matched: false };
};
