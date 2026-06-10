const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Generate daily reminders for all active medications
 * Called by cron job at midnight
 */
async function generateDailyReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const todayDay = dayNames[today.getDay()];

  logger.info(`Generating daily reminders for ${today.toISOString().split('T')[0]}...`);

  // Get all active medications with their schedules
  const medications = await prisma.medication.findMany({
    where: {
      isActive: true,
      startDate: { lte: tomorrow },
      OR: [
        { endDate: null },
        { endDate: { gte: today } },
      ],
    },
    include: {
      schedules: true,
    },
  });

  let reminderCount = 0;

  for (const med of medications) {
    if (med.frequency === 'AS_NEEDED') continue;
    for (const schedule of med.schedules) {
      // Check if this schedule applies to today
      if (schedule.daysOfWeek) {
        const days = schedule.daysOfWeek.split(',').map((d) => d.trim());
        if (!days.includes(todayDay)) continue;
      }

      // Parse schedule time
      const [hours, minutes] = schedule.time.split(':').map(Number);
      const scheduledTime = new Date(today);
      scheduledTime.setHours(hours, minutes, 0, 0);

      // Check if reminder already exists for this schedule + time
      const existingReminder = await prisma.reminder.findFirst({
        where: {
          scheduleId: schedule.id,
          scheduledTime: scheduledTime,
        },
      });

      if (!existingReminder) {
        await prisma.reminder.create({
          data: {
            scheduleId: schedule.id,
            scheduledTime,
            status: 'PENDING',
          },
        });
        reminderCount++;
      }
    }
  }

  logger.success(`Generated ${reminderCount} reminders for today.`);
  return { count: reminderCount };
}

/**
 * Get today's reminders for a user
 */
async function getTodayReminders(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const reminders = await prisma.reminder.findMany({
    where: {
      scheduledTime: {
        gte: today,
        lt: tomorrow,
      },
      schedule: {
        medication: {
          userId,
          isActive: true,
        },
      },
    },
    include: {
      schedule: {
        include: {
          medication: {
            select: {
              id: true,
              name: true,
              dosage: true,
              instructions: true,
              pillCount: true,
              pillsPerDose: true,
            },
          },
        },
      },
      escalation: true,
    },
    orderBy: { scheduledTime: 'asc' },
  });

  // Format response
  return reminders.map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    scheduledTime: r.scheduledTime,
    status: r.status,
    respondedAt: r.respondedAt,
    medicationId: r.schedule.medication.id,
    medicationName: r.schedule.medication.name,
    dosage: r.schedule.medication.dosage,
    instructions: r.schedule.medication.instructions,
    pillCount: r.schedule.medication.pillCount,
    pillsPerDose: r.schedule.medication.pillsPerDose,
    escalationLevel: r.escalation?.level || null,
  }));
}

/**
 * Respond to a reminder (taken, skipped, snoozed)
 */
async function respondToReminder(reminderId, userId, action, note = null) {
  // Verify the reminder belongs to the user
  const reminder = await prisma.reminder.findFirst({
    where: {
      id: reminderId,
      schedule: {
        medication: {
          userId,
        },
      },
    },
    include: {
      schedule: {
        include: {
          medication: true,
        },
      },
    },
  });

  if (!reminder) {
    const error = new Error('Reminder not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  const validActions = ['TAKEN', 'SKIPPED', 'SNOOZED'];
  if (!validActions.includes(action)) {
    const error = new Error(`Invalid action. Must be one of: ${validActions.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();

  let snoozeTime = reminder.scheduledTime;
  
  if (action === 'SNOOZED') {
    snoozeTime = new Date(now.getTime() + 5 * 60 * 1000); // +5 minutes
    logger.info(`Reminder snoozed. Time shifted to ${snoozeTime.toISOString()}`);
  }

  // Update reminder status and time
  const updatedReminder = await prisma.reminder.update({
    where: { id: reminderId },
    data: {
      status: action,
      scheduledTime: action === 'SNOOZED' ? snoozeTime : reminder.scheduledTime,
      respondedAt: action !== 'SNOOZED' ? now : null,
    },
  });

  // Decrement pill count if tracking inventory
  if (action === 'TAKEN' && reminder.schedule.medication.pillCount != null) {
    const med = reminder.schedule.medication;
    const newCount = Math.max(0, med.pillCount - (med.pillsPerDose || 1));
    await prisma.medication.update({
      where: { id: med.id },
      data: { pillCount: newCount },
    });
    logger.info(`Pill count for ${med.name} decremented to ${newCount}`);
  }

  // Create log entry
  await prisma.reminderLog.create({
    data: {
      reminderId,
      action,
      note,
    },
  });

  logger.info(`Reminder ${reminderId}: ${action} by user ${userId}`);
  return updatedReminder;
}

/**
 * Get reminder history for a user with optional filters
 */
async function getHistory(userId, { startDate, endDate, status, page = 1, limit = 20 } = {}) {
  const where = {
    schedule: {
      medication: {
        userId,
      },
    },
  };

  if (startDate || endDate) {
    where.scheduledTime = {};
    if (startDate) where.scheduledTime.gte = new Date(startDate);
    if (endDate) where.scheduledTime.lte = new Date(endDate);
  }

  if (status) {
    where.status = status;
  }

  const skip = (page - 1) * limit;

  const [reminders, total] = await Promise.all([
    prisma.reminder.findMany({
      where,
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
        logs: {
          orderBy: { timestamp: 'desc' },
        },
      },
      orderBy: { scheduledTime: 'desc' },
      skip,
      take: limit,
    }),
    prisma.reminder.count({ where }),
  ]);

  return {
    reminders: reminders.map((r) => ({
      id: r.id,
      scheduledTime: r.scheduledTime,
      status: r.status,
      respondedAt: r.respondedAt,
      medicationName: r.schedule.medication.name,
      dosage: r.schedule.medication.dosage,
      logs: r.logs,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Sync reminders for a user — returns all pending reminders
 * Used by Android app to sync local database
 */
async function syncReminders(userId) {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  // Get all pending reminders from now until end of day
  const reminders = await prisma.reminder.findMany({
    where: {
      status: 'PENDING',
      scheduledTime: {
        gte: now,
        lte: endOfDay,
      },
      schedule: {
        medication: {
          userId,
          isActive: true,
        },
      },
    },
    include: {
      schedule: {
        include: {
          medication: {
            select: {
              id: true,
              name: true,
              dosage: true,
              instructions: true,
              pillCount: true,
              pillsPerDose: true,
            },
          },
        },
      },
    },
    orderBy: { scheduledTime: 'asc' },
  });

  return reminders.map((r) => ({
    id: r.id,
    scheduleId: r.scheduleId,
    scheduledTime: r.scheduledTime,
    status: r.status,
    medicationId: r.schedule.medication.id,
    medicationName: r.schedule.medication.name,
    dosage: r.schedule.medication.dosage,
    instructions: r.schedule.medication.instructions,
    pillCount: r.schedule.medication.pillCount,
    pillsPerDose: r.schedule.medication.pillsPerDose,
  }));
}

module.exports = {
  generateDailyReminders,
  getTodayReminders,
  respondToReminder,
  getHistory,
  syncReminders,
};
