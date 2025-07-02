require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { ensureWebhookRegistered } = require('./services/shopify.service');
const mongoose = require('mongoose');

const webhookRoutes = require('./routes/webhook.routes');
const xeroRoutes = require('./routes/xero.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

app.use('/webhook', webhookRoutes); 
app.use('/xero', xeroRoutes);

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await ensureWebhookRegistered();
});
