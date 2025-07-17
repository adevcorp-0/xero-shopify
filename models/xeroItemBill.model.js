const mongoose = require('mongoose');

const xeroItemBillSchema = new mongoose.Schema({
  itemCode: { type: String, required: true },            // e.g., SHOPIFY-SKU-123
  invoiceId: { type: String, required: true },           // Xero InvoiceID
  quantity: { type: Number, required: true },            // Quantity billed
  syncedAt: { type: Date, default: Date.now },           // When bill was created
  reference: { type: String },                           // Optional: Xero bill reference
}, {
  collection: 'xero_item_bills'
});

module.exports = mongoose.model('XeroItemBill', xeroItemBillSchema);
