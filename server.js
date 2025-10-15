require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { ensureWebhookRegistered, clearAllWebhooks, syncAllOrders } = require('./services/shopify.service');
const mongoose = require('mongoose');
const { createABill, voidInvoicesByContactName, listInvoicesAfter, cleanTestInvoices, voidCreditNotesByContact } = require('./services/xero.service');
const webhookRoutes = require('./routes/webhook.routes');
const xeroRoutes = require('./routes/xero.routes');
const { bulkSyncVariantsToXero } = require('./services/shopify.service');
const { getHome } = require('./controllers/webhook.controller');

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/webhook', bodyParser.raw({ type: 'application/json' }));
app.use('/webhook', webhookRoutes);
app.use('/xero', xeroRoutes);
app.get('/', getHome);

const MongoURI = "mongodb://mongo:pFbSsotNzxPyKQEteWgvOSBQejYwmOxe@centerbeam.proxy.rlwy.net:43486/shopify_xero_sync?authSource=admin";
console.log("Mongo url ========= : ", MongoURI);
mongoose.connect(MongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // await syncAllOrders();
  // setInterval(syncAllOrders, 120 * 60 * 1000);
  // await ensureWebhookRegistered();
  // voidInvoicesByContact("w.mkl.corp@gmail.com", "2025-06-01")
  //   .then(() => console.log("✅ Cleanup finished"))
  //   .catch(err => console.error("❌ Cleanup failed:", err.message));

  // await listInvoicesAfter("2025-06-01");
  // await voidInvoicesByContactName("Sasa Milojevic", "2025-06-01");
  // await voidCreditNotesByContact("Sasa Milojevic", "2025-06-01");
  // await createABill();
  // await clearAllWebhooks();
  // try {
  //   console.log("📦 Starting bulk variant sync to Xero...");
  //   await bulkSyncVariantsToXero();
  //   console.log("✅ Bulk variant sync completed.");
  // } catch (err) {
  //   console.error("❌ Failed to sync variants on startup:", err);
  // }
});