const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Link a caregiver to a patient by caregiver email
 */
async function linkCaregiver(patientId, caregiverEmail) {
  // Find caregiver user by email
  const caregiver = await prisma.user.findUnique({
    where: { email: caregiverEmail.toLowerCase().trim() },
  });

  if (!caregiver) {
    const error = new Error('No user found with this email. They must register first.');
    error.statusCode = 404;
    throw error;
  }

  if (caregiver.id === patientId) {
    const error = new Error('You cannot add yourself as a caregiver.');
    error.statusCode = 400;
    throw error;
  }

  // Check if link already exists
  const existingLink = await prisma.caregiverLink.findUnique({
    where: {
      caregiverId_patientId: {
        caregiverId: caregiver.id,
        patientId,
      },
    },
  });

  if (existingLink) {
    if (existingLink.isActive) {
      const error = new Error('This caregiver is already linked to you.');
      error.statusCode = 409;
      throw error;
    }

    // Reactivate existing link
    const link = await prisma.caregiverLink.update({
      where: { id: existingLink.id },
      data: { isActive: true },
      include: {
        caregiver: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    logger.info(`Caregiver link reactivated: ${caregiver.email} → patient ${patientId}`);
    return link;
  }

  // Create new link
  const link = await prisma.caregiverLink.create({
    data: {
      caregiverId: caregiver.id,
      patientId,
    },
    include: {
      caregiver: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });

  // Update caregiver role if they're currently just a USER
  if (caregiver.role === 'USER') {
    await prisma.user.update({
      where: { id: caregiver.id },
      data: { role: 'CAREGIVER' },
    });
    logger.info(`User ${caregiver.email} role upgraded to CAREGIVER`);
  }

  logger.success(`Caregiver linked: ${caregiver.email} → patient ${patientId}`);
  return link;
}

/**
 * Get all patients linked to a caregiver
 */
async function getPatients(caregiverId) {
  const links = await prisma.caregiverLink.findMany({
    where: {
      caregiverId,
      isActive: true,
    },
    include: {
      patient: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          medications: {
            where: { isActive: true },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  return links.map((link) => ({
    linkId: link.id,
    patient: link.patient,
    linkedAt: link.createdAt,
  }));
}

/**
 * Get a specific patient's reminders (for caregiver view)
 */
async function getPatientReminders(caregiverId, patientId) {
  // Verify caregiver has access to this patient
  const link = await prisma.caregiverLink.findFirst({
    where: {
      caregiverId,
      patientId,
      isActive: true,
    },
  });

  if (!link) {
    const error = new Error('You are not linked to this patient.');
    error.statusCode = 403;
    throw error;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const reminders = await prisma.reminder.findMany({
    where: {
      scheduledTime: { gte: today, lt: tomorrow },
      schedule: {
        medication: {
          userId: patientId,
          isActive: true,
        },
      },
    },
    include: {
      schedule: {
        include: {
          medication: {
            select: { name: true, dosage: true, instructions: true },
          },
        },
      },
      escalation: true,
    },
    orderBy: { scheduledTime: 'asc' },
  });

  // Get adherence stats for last 7 days
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const stats = await prisma.reminder.groupBy({
    by: ['status'],
    where: {
      scheduledTime: { gte: weekAgo },
      schedule: {
        medication: {
          userId: patientId,
        },
      },
    },
    _count: true,
  });

  const statsMap = {};
  stats.forEach((s) => {
    statsMap[s.status] = s._count;
  });

  const total = Object.values(statsMap).reduce((a, b) => a + b, 0);
  const takenCount = statsMap.TAKEN || 0;
  const missedCount = statsMap.MISSED || 0;
  const adherenceRate = total > 0 ? (takenCount / total) * 100 : 0;

  return {
    todayReminders: reminders.map((r) => ({
      id: r.id,
      scheduledTime: r.scheduledTime,
      status: r.status,
      medicationName: r.schedule.medication.name,
      dosage: r.schedule.medication.dosage,
      escalationLevel: r.escalation?.level || null,
      schedule: { medication: { name: r.schedule.medication.name, dosage: r.schedule.medication.dosage } },
    })),
    takenCount,
    missedCount,
    adherenceRate,
  };
}

/**
 * Get caregivers linked to a patient
 */
async function getLinkedCaregivers(patientId) {
  const links = await prisma.caregiverLink.findMany({
    where: {
      patientId,
      isActive: true,
    },
    include: {
      caregiver: {
        select: { id: true, name: true, email: true, phone: true },
      },
    },
  });

  return links.map((link) => ({
    linkId: link.id,
    caregiver: link.caregiver,
    linkedAt: link.createdAt,
  }));
}

/**
 * Unlink a caregiver
 */
async function unlinkCaregiver(linkId, userId) {
  const link = await prisma.caregiverLink.findFirst({
    where: {
      id: linkId,
      OR: [
        { patientId: userId },
        { caregiverId: userId },
      ],
    },
  });

  if (!link) {
    const error = new Error('Caregiver link not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  await prisma.caregiverLink.update({
    where: { id: linkId },
    data: { isActive: false },
  });

  logger.info(`Caregiver link deactivated: ${linkId}`);
  return { message: 'Caregiver unlinked successfully.' };
}

/**
 * Verify if a caregiver has an active link to a patient
 */
async function verifyLink(caregiverId, patientId) {
  const link = await prisma.caregiverLink.findFirst({
    where: {
      caregiverId,
      patientId,
      isActive: true,
    },
  });
  return !!link;
}

module.exports = {
  linkCaregiver,
  getPatients,
  getPatientReminders,
  getLinkedCaregivers,
  unlinkCaregiver,
  verifyLink,
};
