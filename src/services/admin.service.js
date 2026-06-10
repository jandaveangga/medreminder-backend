const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Get all users with optional filters (Admin only)
 */
async function getAllUsers({ role, search, page = 1, limit = 20 } = {}) {
  const where = {};

  if (role) where.role = role;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            medications: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((u) => ({
      ...u,
      medicationCount: u._count.medications,
      _count: undefined,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Get user details by ID (Admin/Doctor)
 */
async function getUserById(id) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      medications: {
        include: { schedules: true },
        orderBy: { createdAt: 'desc' },
      },
      caregiverOf: {
        where: { isActive: true },
        include: {
          patient: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      patients: {
        where: { isActive: true },
        include: {
          caregiver: {
            select: { id: true, name: true, email: true },
          },
        },
      },
    },
  });

  if (!user) {
    const error = new Error('User not found.');
    error.statusCode = 404;
    throw error;
  }

  return user;
}

/**
 * Update a user's role (Admin only)
 */
async function updateUserRole(id, role) {
  const validRoles = ['USER', 'CAREGIVER', 'DOCTOR', 'ADMIN'];
  if (!validRoles.includes(role)) {
    const error = new Error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  logger.info(`User role updated: ${user.email} → ${role}`);
  return user;
}

/**
 * Get system-wide statistics (Admin only)
 */
async function getSystemStats() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    totalUsers,
    usersByRole,
    totalMedications,
    activeMedications,
    todayReminders,
    todayRemindersByStatus,
    weeklyStats,
    activeEscalations,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.medication.count(),
    prisma.medication.count({ where: { isActive: true } }),
    prisma.reminder.count({
      where: { scheduledTime: { gte: today, lt: tomorrow } },
    }),
    prisma.reminder.groupBy({
      by: ['status'],
      where: { scheduledTime: { gte: today, lt: tomorrow } },
      _count: true,
    }),
    prisma.reminder.groupBy({
      by: ['status'],
      where: { scheduledTime: { gte: weekAgo } },
      _count: true,
    }),
    prisma.escalation.count({
      where: {
        level: { in: ['LEVEL_3', 'LEVEL_4', 'LEVEL_5'] },
        createdAt: { gte: weekAgo },
      },
    }),
  ]);

  const roleMap = {};
  usersByRole.forEach((r) => { roleMap[r.role] = r._count; });

  const todayStatusMap = {};
  todayRemindersByStatus.forEach((s) => { todayStatusMap[s.status] = s._count; });

  const weeklyStatusMap = {};
  weeklyStats.forEach((s) => { weeklyStatusMap[s.status] = s._count; });

  const weeklyTotal = Object.values(weeklyStatusMap).reduce((a, b) => a + b, 0);
  const adherenceRate = weeklyTotal > 0
    ? Math.round(((weeklyStatusMap.TAKEN || 0) / weeklyTotal) * 100)
    : 0;

  return {
    users: {
      total: totalUsers,
      byRole: roleMap,
    },
    medications: {
      total: totalMedications,
      active: activeMedications,
    },
    reminders: {
      today: {
        total: todayReminders,
        byStatus: todayStatusMap,
      },
      weekly: {
        byStatus: weeklyStatusMap,
        adherenceRate: `${adherenceRate}%`,
      },
    },
    escalations: {
      activeThisWeek: activeEscalations,
    },
  };
}

/**
 * Get all escalations with optional filters (Admin/Doctor)
 */
async function getAllEscalations({ level, page = 1, limit = 20 } = {}) {
  const where = {};
  if (level) where.level = level;

  const skip = (page - 1) * limit;

  const [escalations, total] = await Promise.all([
    prisma.escalation.findMany({
      where,
      include: {
        reminder: {
          include: {
            schedule: {
              include: {
                medication: {
                  include: {
                    user: {
                      select: { id: true, name: true, email: true, phone: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.escalation.count({ where }),
  ]);

  return {
    escalations: escalations.map((e) => ({
      id: e.id,
      level: e.level,
      smsSent: e.smsSent,
      smsSentAt: e.smsSentAt,
      caregiverNotified: e.caregiverNotified,
      reminderStatus: e.reminder.status,
      scheduledTime: e.reminder.scheduledTime,
      medicationName: e.reminder.schedule.medication.name,
      dosage: e.reminder.schedule.medication.dosage,
      patient: e.reminder.schedule.medication.user,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = {
  getAllUsers,
  getUserById,
  updateUserRole,
  getSystemStats,
  getAllEscalations,
};
