const express = require('express');
const { param } = require('express-validator');
const escalationService = require('../services/escalation.service');
const authMiddleware = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const validate = require('../middleware/validate');
const prisma = require('../config/database');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * POST /api/escalations/check
 * Trigger the escalation check logic manually (restricted to ADMIN and DOCTOR)
 */
router.post('/check', roleGuard(['ADMIN', 'DOCTOR']), async (req, res, next) => {
  try {
    const result = await escalationService.checkAndEscalate();
    res.json({
      success: true,
      message: 'Escalation check completed.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/escalations/:reminderId
 * Get escalation status for a specific reminder
 * Verifies that the reminder belongs to the user, their patient (if caregiver), or accessible by doctor/admin
 */
router.get(
  '/:reminderId',
  validate([
    param('reminderId').isUUID().withMessage('Invalid reminder ID.'),
  ]),
  async (req, res, next) => {
    try {
      const { reminderId } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Find the reminder and its owner
      const reminder = await prisma.reminder.findUnique({
        where: { id: reminderId },
        include: {
          schedule: {
            include: {
              medication: {
                select: { userId: true },
              },
            },
          },
        },
      });

      if (!reminder) {
        return res.status(404).json({
          success: false,
          message: 'Reminder not found.',
        });
      }

      const patientId = reminder.schedule.medication.userId;

      // Authorization check: User owns reminder, OR is Doctor/Admin, OR is caregiver of patient
      let authorized = false;

      if (patientId === userId) {
        authorized = true;
      } else if (['ADMIN', 'DOCTOR'].includes(userRole)) {
        authorized = true;
      } else if (userRole === 'CAREGIVER') {
        const link = await prisma.caregiverLink.findFirst({
          where: {
            caregiverId: userId,
            patientId: patientId,
            isActive: true,
          },
        });
        if (link) authorized = true;
      }

      if (!authorized) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this escalation status.',
        });
      }

      const status = await escalationService.getEscalationStatus(reminderId);
      res.json({
        success: true,
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
