require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { ensureWebhookRegistered } = require('./services/shopify.service');
const mongoose = require('mongoose');

const webhookRoutes = require('./routes/webhook.routes');
const xeroRoutes = require('./routes/xero.routes');
const { bulkSyncVariantsToXero } = require('./services/shopify.service');

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

app.use('/webhook', webhookRoutes);
app.use('/xero', xeroRoutes);

console.log("Mongo url ========= : ", process.env.MONGO_CUSTOM_URI);
mongoose.connect(process.env.MONGO_CUSTOM_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await ensureWebhookRegistered();
  // try {
  //   console.log("📦 Starting bulk variant sync to Xero...");
  //   await bulkSyncVariantsToXero();
  //   console.log("✅ Bulk variant sync completed.");
  // } catch (err) {
  //   console.error("❌ Failed to sync variants on startup:", err);
  // }

});
