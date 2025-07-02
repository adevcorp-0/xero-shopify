require('dotenv').config();
const mongoose = require('mongoose');
const { saveInitialToken } = require('./services/xeroToken.service');

const MONGO_URI = process.env.MONGO_URI;

const initialTokens = {
  access_token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgxNTcwRUZDMTkiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJISy1PWm5jdGJjQW8xbkp2MENZVmdWY09fQmsifQ.eyJuYmYiOjE3NTEwNTUzNDUsImV4cCI6MTc1MTA1NzE0NSwiaXNzIjoiaHR0cHM6Ly9pZGVudGl0eS54ZXJvLmNvbSIsImF1ZCI6Imh0dHBzOi8vaWRlbnRpdHkueGVyby5jb20vcmVzb3VyY2VzIiwiY2xpZW50X2lkIjoiOEE1QTg3N0QxMTFCNEQ2N0JGRDU2N0EzMzBEMTFCNjQiLCJzdWIiOiIzZjMxOGMwMGI4YzI1NjhmOTI1Yjc3MjczN2RmYmY3ZSIsImF1dGhfdGltZSI6MTc1MTA1NTMzNSwieGVyb191c2VyaWQiOiI0MjE1N2E2NS1jZTMwLTQwOWYtOGI5Yy1lYjIxM2QyNTA2YWMiLCJnbG9iYWxfc2Vzc2lvbl9pZCI6Ijc4MDY1NWFiODZiNjQ5MmE5YzFkZDYyZDE5MTk1ZTM0Iiwic2lkIjoiNzgwNjU1YWI4NmI2NDkyYTljMWRkNjJkMTkxOTVlMzQiLCJqdGkiOiJBMTg2NjRGQzU3REI1RUQ4MDUyRjk1QzZEQjAyMjNCOCIsImF1dGhlbnRpY2F0aW9uX2V2ZW50X2lkIjoiMzJlNGViZTktNDVmZC00YjFkLWIwMzUtNmM5N2ZlN2MzZGNjIiwic2NvcGUiOlsiZW1haWwiLCJwcm9maWxlIiwib3BlbmlkIiwiYWNjb3VudGluZy5zZXR0aW5ncyIsImFjY291bnRpbmcuY29udGFjdHMiLCJvZmZsaW5lX2FjY2VzcyJdLCJhbXIiOlsicHdkIiwibWZhIiwib3RwIl19.Dt6Q8qHkEyW3uQLKwEy2-4f-JTnplPI_YoJY1UiOvqhf65b-D3rTcPhxWQXEgXSwAlGSWRGS_RPuOxwyX50SepFCdvjypvYoEq2Pjl-BxBTdH3DTVLnKYrrJPzLx4NMgzkHgkA6ZW-bjkyJZkGC7HAquamG2b2S2Vm1_bC9edQPUfvcqIbBgs_KZN0MaxZ8YVYvY8ZIa-G9n7izde953uVRyzsCZbc0jHcHrht8qv8QFC34oIWFwZuVkY5LU4RUn3tupByNWPG_VbLSRXmUFTyEQx2-VjApeYWG4clJuXy8FjSAUFUjmdolLefR_8OuMqDei4eQ8OVzVyrgJc-fpQQ',
  refresh_token: 'yddghzboOz10MiB8nKyWPWTaxkzGD7P3X5c7FkxJ31k',
  expires_in: 3600, // or actual seconds if you want, just pick something reasonable, e.g. 1 hour
  tenantId: '47425993-155f-4bb6-abc3-de1d8200071e',
};

async function saveToken() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    await saveInitialToken(initialTokens);
    console.log('✅ Token saved to DB');

    mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error saving token:', error);
  }
}

saveToken();
