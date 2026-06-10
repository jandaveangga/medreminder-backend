const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cron = require('node-cron');

const env = require('./config/env');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Route Imports
const authRoutes = require('./routes/auth.routes');
const medicationRoutes = require('./routes/medication.routes');
const reminderRoutes = require('./routes/reminder.routes');
const escalationRoutes = require('./routes/escalation.routes');
const caregiverRoutes = require('./routes/caregiver.routes');
const adminRoutes = require('./routes/admin.routes');

// Service Imports for Cron
const reminderService = require('./services/reminder.service');
const escalationService = require('./services/escalation.service');

const app = express();

// Security and Logging Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request Logger
if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Health Check API
app.get('/api/health', (req, res) => {
  res.json({
    status: 'UP',
    timestamp: new Date(),
    environment: env.NODE_ENV,
    twilio: env.TWILIO_ENABLED ? 'CONFIGURED' : 'NOT_CONFIGURED',
  });
});

// Route Mounting
app.use('/api/auth', authRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/escalations', escalationRoutes);
app.use('/api/caregivers', caregiverRoutes);
app.use('/api/admin', adminRoutes);

// Background Cron Jobs
// 1. Generate daily reminders at midnight (00:00) local time
cron.schedule('0 0 * * *', async () => {
  try {
    logger.info('Cron: Running daily reminder generation job...');
    const result = await reminderService.generateDailyReminders();
    logger.info(`Cron: Daily reminder generation complete. Created: ${result.count}`);
  } catch (error) {
    logger.error('Cron: Daily reminder generation failed!', error);
  }
});

// 2. Check pending reminders and trigger escalations/alerts every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  try {
    logger.info('Cron: Running escalation check job...');
    const result = await escalationService.checkAndEscalate();
    logger.info(`Cron: Escalation check complete. Processed: ${result.processed}, SMS sent: ${result.smsSent}, Caregiver alerts: ${result.caregiverAlerts}`);
  } catch (error) {
    logger.error('Cron: Escalation check failed!', error);
  }
});

// 3. Self-ping every 14 minutes to keep Render free tier awake
cron.schedule('*/14 * * * *', () => {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT}`;
  fetch(`${url}/api/health`)
    .then(() => logger.info('Keep-alive ping sent successfully.'))
    .catch(() => logger.warn('Keep-alive ping failed (server may be starting up).'));
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use(errorHandler);

// Start Server
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.success(`🚀 Server is running on port ${env.PORT} in ${env.NODE_ENV} mode.`);
  
  // Proactively run a check-and-escalate and reminder-generation check on startup to seed/populate if database is fresh
  if (env.NODE_ENV === 'development') {
    logger.info('Development Startup: Running startup tasks...');
    
    // Asynchronously trigger daily reminder generation on startup so devs don't wait for midnight
    reminderService.generateDailyReminders()
      .then((res) => logger.info(`Development Startup: Reminder generation check complete. Generated ${res.count} reminders.`))
      .catch((err) => logger.error('Development Startup: Failed to generate reminders on startup', err));
      
    // Asynchronously trigger escalation check on startup
    escalationService.checkAndEscalate()
      .then((res) => logger.info(`Development Startup: Escalation check complete. Processed ${res.processed} reminders.`))
      .catch((err) => logger.error('Development Startup: Failed to check escalations on startup', err));
  }
});

module.exports = app;
