const express = require('express');
const { body, param, query } = require('express-validator');
const medicationService = require('../services/medication.service');
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
 * GET /api/medications
 * Get all medications for the authenticated user
 */
router.get('/', async (req, res, next) => {
  try {
    const targetUserId = await getTargetUserId(req);
    const medications = await medicationService.getAll(targetUserId);
    res.json({
      success: true,
      data: medications,
      count: medications.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/medications/:id
 * Get a specific medication
 */
router.get(
  '/:id',
  validate([
    param('id').isUUID().withMessage('Invalid medication ID.'),
  ]),
  async (req, res, next) => {
    try {
      const targetUserId = await getTargetUserId(req);
      const medication = await medicationService.getById(req.params.id, targetUserId);
      res.json({
        success: true,
        data: medication,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/medications
 * Create a new medication with schedules
 */
router.post(
  '/',
  validate([
    body('name').trim().notEmpty().withMessage('Medication name is required.')
      .isLength({ max: 200 }).withMessage('Name must be 200 characters or less.'),
    body('dosage').trim().notEmpty().withMessage('Dosage is required.')
      .isLength({ max: 100 }).withMessage('Dosage must be 100 characters or less.'),
    body('instructions').optional().trim().isLength({ max: 500 }),
    body('frequency').isIn(['DAILY', 'TWICE_DAILY', 'THREE_TIMES_DAILY', 'WEEKLY', 'CUSTOM', 'AS_NEEDED'])
      .withMessage('Invalid frequency.'),
    body('startDate').isISO8601().withMessage('Valid start date is required.'),
    body('endDate').optional({ nullable: true }).isISO8601().withMessage('Invalid end date.'),
    body('pillCount').optional({ nullable: true }).isInt({ min: 0 }).withMessage('Pill count must be a non-negative integer.'),
    body('pillsPerDose').optional().isInt({ min: 1 }).withMessage('Pills per dose must be at least 1.'),
    body('schedules').optional().isArray().withMessage('Schedules must be an array.'),
    body('schedules.*.time').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .withMessage('Schedule time must be in HH:mm format.'),
    body('schedules.*.daysOfWeek').optional().isString(),
  ]),
  async (req, res, next) => {
    try {
      const targetUserId = await getTargetUserId(req);
      const medication = await medicationService.create({
        userId: targetUserId,
        ...req.body,
      });
      
      // Generate reminders immediately so the user can see them today
      await reminderService.generateDailyReminders();
      
      res.status(201).json({
        success: true,
        message: 'Medication created successfully.',
        data: medication,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/medications/:id
 * Update a medication
 */
router.put(
  '/:id',
  validate([
    param('id').isUUID().withMessage('Invalid medication ID.'),
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('dosage').optional().trim().isLength({ min: 1, max: 100 }),
    body('instructions').optional().trim().isLength({ max: 500 }),
    body('frequency').optional().isIn(['DAILY', 'TWICE_DAILY', 'THREE_TIMES_DAILY', 'WEEKLY', 'CUSTOM', 'AS_NEEDED']),
    body('startDate').optional().isISO8601(),
    body('endDate').optional({ nullable: true }).isISO8601(),
    body('isActive').optional().isBoolean(),
    body('pillCount').optional({ nullable: true }).isInt({ min: 0 }),
    body('pillsPerDose').optional().isInt({ min: 1 }),
    body('schedules').optional().isArray(),
    body('schedules.*.time').optional().matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
  ]),
  async (req, res, next) => {
    try {
      const targetUserId = await getTargetUserId(req);
      const medication = await medicationService.update(req.params.id, targetUserId, req.body);
      
      // Regenerate reminders in case schedule changed
      await reminderService.generateDailyReminders();
      
      res.json({
        success: true,
        message: 'Medication updated successfully.',
        data: medication,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/medications/:id
 * Delete a medication
 */
router.delete(
  '/:id',
  validate([
    param('id').isUUID().withMessage('Invalid medication ID.'),
  ]),
  async (req, res, next) => {
    try {
      const targetUserId = await getTargetUserId(req);
      const result = await medicationService.remove(req.params.id, targetUserId);
      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
