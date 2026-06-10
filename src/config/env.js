const dotenv = require('dotenv');
const path = require('path');

// Load .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || 'default-dev-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@admin.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@123456',
};

// Validate required environment variables
const requiredVars = ['DATABASE_URL'];
const missing = requiredVars.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Please copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// Twilio availability check
env.TWILIO_ENABLED =
  env.TWILIO_ACCOUNT_SID !== '' &&
  env.TWILIO_AUTH_TOKEN !== '' &&
  env.TWILIO_PHONE_NUMBER !== '' &&
  !env.TWILIO_ACCOUNT_SID.startsWith('your_');

if (!env.TWILIO_ENABLED) {
  console.warn('⚠️  Twilio SMS is not configured. SMS alerts will be logged but not sent.');
}

module.exports = env;
