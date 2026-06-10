const express = require('express');
const { body, param } = require('express-validator');
const caregiverService = require('../services/caregiver.service');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/caregivers/link
 * Link a caregiver by caregiver's email address
 * Called by patient to link a caregiver to themselves
 */
router.post(
  '/link',
  validate([
    body('email').trim().isEmail().withMessage('Valid caregiver email is required.').normalizeEmail(),
  ]),
  async (req, res, next) => {
    try {
      const patientId = req.user.id;
      const { email } = req.body;
      const link = await caregiverService.linkCaregiver(patientId, email);
      res.status(201).json({
        success: true,
        message: 'Caregiver linked successfully.',
        data: link,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/caregivers/patients
 * Get list of patients linked to the current user (current user is the Caregiver)
 */
router.get('/patients', async (req, res, next) => {
  try {
    const caregiverId = req.user.id;
    const patients = await caregiverService.getPatients(caregiverId);
    res.json({
      success: true,
      data: patients,
      count: patients.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/caregivers/patients/:id/reminders
 * Get a specific patient's reminders and weekly adherence stats
 * Called by caregiver to monitor patient's medications
 */
router.get(
  '/patients/:id/reminders',
  validate([
    param('id').isUUID().withMessage('Invalid patient ID.'),
  ]),
  async (req, res, next) => {
    try {
      const caregiverId = req.user.id;
      const patientId = req.params.id;
      const data = await caregiverService.getPatientReminders(caregiverId, patientId);
      res.json({
        success: true,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/caregivers/caregivers
 * Get list of caregivers linked to the current user (current user is the Patient)
 */
router.get('/caregivers', async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const caregivers = await caregiverService.getLinkedCaregivers(patientId);
    res.json({
      success: true,
      data: caregivers,
      count: caregivers.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/caregivers/link/:id
 * Unlink a caregiver-patient relationship
 * Can be called by either caregiver or patient
 */
router.delete(
  '/link/:id',
  validate([
    param('id').isUUID().withMessage('Invalid link ID.'),
  ]),
  async (req, res, next) => {
    try {
      const linkId = req.params.id;
      const userId = req.user.id;
      const result = await caregiverService.unlinkCaregiver(linkId, userId);
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
