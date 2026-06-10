const express = require('express');
const { body, param, query } = require('express-validator');
const reminderService = require('../services/reminder.service');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');
const caregiverService = require('../services/caregiver.service');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

async function getTargetUserId(req) {
  let targetId = req.user.id;
  if (req.user.role === 'CAREGIVER' && req.query.patientId) {
    const isLinked = await caregiverService.verifyLink(req.user.id, req.query.patientId);
    if (!isLinked) {
      const err = new Error('Access denied to this patient');
      err.statusCode = 403;
      throw err;
    }
    targetId = req.query.patientId;
  }
  return targetId;
}

/**
 * GET /api/reminders/today
 * Get today's reminders for the authenticated user
 */
router.get('/today', async (req, res, next) => {
  try {
    const targetUserId = await getTargetUserId(req);
    const reminders = await reminderService.getTodayReminders(targetUserId);
    res.json({
      success: true,
      data: reminders,
      count: reminders.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reminders/sync
 * Sync pending reminders from now until end of day for offline usage in Android app
 */
router.get('/sync', async (req, res, next) => {
  try {
    const targetUserId = await getTargetUserId(req);
    const reminders = await reminderService.syncReminders(targetUserId);
    res.json({
      success: true,
      data: reminders,
      count: reminders.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/reminders/history
 * Get filtered/paginated history of reminders
 */
router.get(
  '/history',
  validate([
    query('startDate').optional().isISO8601().withMessage('Invalid start date format.'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date format.'),
    query('status').optional().isIn(['TAKEN', 'SKIPPED', 'SNOOZED', 'MISSED', 'PENDING']).withMessage('Invalid status filter.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ]),
  async (req, res, next) => {
    try {
      const targetUserId = await getTargetUserId(req);
      const { startDate, endDate, status, page, limit } = req.query;
      const historyData = await reminderService.getHistory(targetUserId, {
        startDate,
        endDate,
        status,
        page: page || 1,
        limit: limit || 20,
      });
      res.json({
        success: true,
        data: historyData.reminders,
        pagination: historyData.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/reminders/:id/respond
 * Record response (TAKEN, SKIPPED, SNOOZED) for a reminder
 */
router.post(
  '/:id/respond',
  validate([
    param('id').isUUID().withMessage('Invalid reminder ID.'),
    body('action').isIn(['TAKEN', 'SKIPPED', 'SNOOZED']).withMessage('Action must be TAKEN, SKIPPED, or SNOOZED.'),
    body('note').optional().trim().isLength({ max: 500 }).withMessage('Note must be 500 characters or less.'),
  ]),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { action, note } = req.body;
      const updatedReminder = await reminderService.respondToReminder(id, req.user.id, action, note);
      res.json({
        success: true,
        message: `Reminder successfully marked as ${action}.`,
        data: updatedReminder,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
