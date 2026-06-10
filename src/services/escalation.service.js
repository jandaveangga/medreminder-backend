const prisma = require('../config/database');
const smsService = require('./sms.service');
const logger = require('../utils/logger');

/**
 * Escalation timing thresholds (minutes after scheduled time)
 */
const ESCALATION_THRESHOLDS = {
  LEVEL_1: 0,   // Immediate notification (handled by Android app)
  LEVEL_2: 15,  // Persistent alarm
  LEVEL_3: 30,  // Mark as missed
  LEVEL_4: 45,  // Send SMS to user
  LEVEL_5: 60,  // Send SMS to caregiver
};

/**
 * Check all pending reminders and escalate as needed
 * Called by cron job every 5 minutes
 */
async function checkAndEscalate() {
  const now = new Date();

  // Find all PENDING reminders that are past their scheduled time
  const pendingReminders = await prisma.reminder.findMany({
    where: {
      status: 'PENDING',
      scheduledTime: { lt: now },
    },
    include: {
      schedule: {
        include: {
          medication: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      },
      escalation: true,
    },
  });

  if (pendingReminders.length === 0) return { processed: 0 };

  let processed = 0;
  let smsSent = 0;
  let caregiverAlerts = 0;

  for (const reminder of pendingReminders) {
    const minutesOverdue = Math.floor((now - reminder.scheduledTime) / (1000 * 60));
    const user = reminder.schedule.medication.user;
    const medName = reminder.schedule.medication.name;

    // Determine current escalation level based on time
    let targetLevel;
    if (minutesOverdue >= ESCALATION_THRESHOLDS.LEVEL_5) {
      targetLevel = 'LEVEL_5';
    } else if (minutesOverdue >= ESCALATION_THRESHOLDS.LEVEL_4) {
      targetLevel = 'LEVEL_4';
    } else if (minutesOverdue >= ESCALATION_THRESHOLDS.LEVEL_3) {
      targetLevel = 'LEVEL_3';
    } else if (minutesOverdue >= ESCALATION_THRESHOLDS.LEVEL_2) {
      targetLevel = 'LEVEL_2';
    } else {
      targetLevel = 'LEVEL_1';
    }

    // Get or create escalation record
    let escalation = reminder.escalation;
    if (!escalation) {
      escalation = await prisma.escalation.create({
        data: {
          reminderId: reminder.id,
          level: 'LEVEL_1',
        },
      });
    }

    // Check if we need to escalate further
    const levelOrder = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'];
    const currentIndex = levelOrder.indexOf(escalation.level);
    const targetIndex = levelOrder.indexOf(targetLevel);

    if (targetIndex <= currentIndex) continue; // Already at or past this level

    // Process escalation
    const updateData = { level: targetLevel };

    // Level 3: Mark as missed
    if (targetIndex >= 2 && reminder.status === 'PENDING') {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'MISSED' },
      });

      await prisma.reminderLog.create({
        data: {
          reminderId: reminder.id,
          action: 'MISSED',
          note: `Auto-marked as missed after ${minutesOverdue} minutes`,
        },
      });

      logger.warn(`Reminder ${reminder.id} marked as MISSED (${minutesOverdue}min overdue)`);
    }

    // Level 4: Send SMS to user
    if (targetIndex >= 3 && !escalation.smsSent) {
      const smsResult = await smsService.sendMissedMedicationSMS(
        user.phone,
        user.name,
        medName,
        reminder.scheduledTime
      );

      updateData.smsSent = smsResult.sent || true; // Mark as attempted
      updateData.smsSentAt = new Date();
      smsSent++;

      logger.info(`Level 4 escalation: SMS ${smsResult.sent ? 'sent' : 'attempted'} to ${user.phone}`);
    }

    // Level 5: Notify caregivers
    if (targetIndex >= 4 && !escalation.caregiverNotified) {
      const caregiverLinks = await prisma.caregiverLink.findMany({
        where: {
          patientId: user.id,
          isActive: true,
        },
        include: {
          caregiver: {
            select: {
              name: true,
              phone: true,
              email: true,
            },
          },
        },
      });

      for (const link of caregiverLinks) {
        await smsService.sendCaregiverAlert(
          link.caregiver.phone,
          link.caregiver.name,
          user.name,
          medName,
          reminder.scheduledTime
        );
        caregiverAlerts++;
      }

      updateData.caregiverNotified = caregiverLinks.length > 0;
      logger.info(`Level 5 escalation: ${caregiverLinks.length} caregiver(s) notified for ${user.name}`);
    }

    // Update escalation record
    await prisma.escalation.update({
      where: { id: escalation.id },
      data: updateData,
    });

    processed++;
  }

  logger.info(`Escalation check complete: ${processed} processed, ${smsSent} SMS sent, ${caregiverAlerts} caregiver alerts`);

  return { processed, smsSent, caregiverAlerts };
}

/**
 * Get escalation status for a specific reminder
 */
async function getEscalationStatus(reminderId) {
  const escalation = await prisma.escalation.findUnique({
    where: { reminderId },
    include: {
      reminder: {
        include: {
          schedule: {
            include: {
              medication: {
                select: {
                  name: true,
                  dosage: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!escalation) {
    return { exists: false, reminderId };
  }

  return {
    exists: true,
    id: escalation.id,
    reminderId: escalation.reminderId,
    level: escalation.level,
    smsSent: escalation.smsSent,
    smsSentAt: escalation.smsSentAt,
    caregiverNotified: escalation.caregiverNotified,
    medicationName: escalation.reminder.schedule.medication.name,
    dosage: escalation.reminder.schedule.medication.dosage,
    scheduledTime: escalation.reminder.scheduledTime,
    reminderStatus: escalation.reminder.status,
    createdAt: escalation.createdAt,
    updatedAt: escalation.updatedAt,
  };
}

module.exports = { checkAndEscalate, getEscalationStatus };
