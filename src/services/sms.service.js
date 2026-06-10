const env = require('../config/env');
const logger = require('../utils/logger');

let twilioClient = null;

// Initialize Twilio client only if credentials are provided
if (env.TWILIO_ENABLED) {
  try {
    const twilio = require('twilio');
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    logger.success('Twilio SMS service initialized.');
  } catch (error) {
    logger.warn('Failed to initialize Twilio client:', error.message);
  }
}

/**
 * Send an SMS message via Twilio
 * @param {string} to - Phone number (E.164 format)
 * @param {string} message - SMS body text
 * @returns {Object} Twilio message response or mock response
 */
async function sendSMS(to, message) {
  if (!twilioClient) {
    logger.warn(`SMS NOT SENT (Twilio not configured). To: ${to}, Message: ${message}`);
    return {
      sent: false,
      reason: 'Twilio not configured',
      to,
      message,
    };
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: env.TWILIO_PHONE_NUMBER,
      to,
    });

    logger.success(`SMS sent to ${to}. SID: ${result.sid}`);
    return {
      sent: true,
      sid: result.sid,
      to,
      status: result.status,
    };
  } catch (error) {
    logger.error(`Failed to send SMS to ${to}:`, error.message);
    return {
      sent: false,
      reason: error.message,
      to,
      message,
    };
  }
}

/**
 * Send missed medication SMS to user
 */
async function sendMissedMedicationSMS(phone, userName, medicationName, scheduledTime) {
  const timeStr = new Date(scheduledTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const message =
    `⚠️ MedReminder Alert: Hi ${userName}, you missed your medication "${medicationName}" ` +
    `scheduled at ${timeStr}. Please take it as soon as possible or contact your doctor.`;

  return sendSMS(phone, message);
}

/**
 * Send alert to caregiver about patient's missed medication
 */
async function sendCaregiverAlert(caregiverPhone, caregiverName, patientName, medicationName, scheduledTime) {
  const timeStr = new Date(scheduledTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const message =
    `🚨 MedReminder Caregiver Alert: Hi ${caregiverName}, your patient ${patientName} ` +
    `has missed their medication "${medicationName}" scheduled at ${timeStr}. ` +
    `Please check on them.`;

  return sendSMS(caregiverPhone, message);
}

module.exports = {
  sendSMS,
  sendMissedMedicationSMS,
  sendCaregiverAlert,
};
