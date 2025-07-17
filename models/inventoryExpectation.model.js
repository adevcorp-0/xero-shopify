const mongoose = require('mongoose');

const inventoryExpectationSchema = new mongoose.Schema({
  sku: { type: String, required: true },
  location_id: { type: Number, required: true },
  expected_quantity: { type: Number, required: true },
  reason: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, {
  collection: 'inventory_expectations'
});

inventoryExpectationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('InventoryExpectation', inventoryExpectationSchema);
