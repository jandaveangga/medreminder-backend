const prisma = require('../config/database');
const logger = require('../utils/logger');

/**
 * Create a new medication with schedules
 */
async function create({ userId, name, dosage, instructions, frequency, startDate, endDate, pillCount, pillsPerDose, schedules }) {
  const medication = await prisma.medication.create({
    data: {
      userId,
      name: name.trim(),
      dosage: dosage.trim(),
      instructions: instructions ? instructions.trim() : null,
      frequency,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : null,
      pillCount: pillCount != null ? parseInt(pillCount) : null,
      pillsPerDose: pillsPerDose ? parseInt(pillsPerDose) : 1,
      ...(schedules && schedules.length > 0 && {
        schedules: {
          create: schedules.map((s) => ({
            time: s.time,
            daysOfWeek: s.daysOfWeek || null,
          })),
        },
      }),
    },
    include: {
      schedules: true,
    },
  });

  logger.success(`Medication created: ${medication.name} for user ${userId}`);
  return medication;
}

/**
 * Get all medications for a user
 */
async function getAll(userId) {
  const medications = await prisma.medication.findMany({
    where: { userId },
    include: {
      schedules: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return medications;
}

/**
 * Get medication by ID
 */
async function getById(id, userId = null) {
  const where = { id };
  if (userId) where.userId = userId;

  const medication = await prisma.medication.findFirst({
    where,
    include: {
      schedules: true,
    },
  });

  if (!medication) {
    const error = new Error('Medication not found.');
    error.statusCode = 404;
    throw error;
  }

  return medication;
}

/**
 * Update a medication
 */
async function update(id, userId, data) {
  // Verify ownership
  const existing = await prisma.medication.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    const error = new Error('Medication not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.dosage !== undefined) updateData.dosage = data.dosage.trim();
  if (data.instructions !== undefined) updateData.instructions = data.instructions ? data.instructions.trim() : null;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.pillCount !== undefined) updateData.pillCount = data.pillCount != null ? parseInt(data.pillCount) : null;
  if (data.pillsPerDose !== undefined) updateData.pillsPerDose = parseInt(data.pillsPerDose);

  // Update medication
  const medication = await prisma.medication.update({
    where: { id },
    data: updateData,
    include: { schedules: true },
  });

  // If schedules are provided, replace them
  if (data.schedules) {
    // Delete existing schedules
    await prisma.schedule.deleteMany({ where: { medicationId: id } });

    // Create new schedules
    await prisma.schedule.createMany({
      data: data.schedules.map((s) => ({
        medicationId: id,
        time: s.time,
        daysOfWeek: s.daysOfWeek || null,
      })),
    });

    // Refetch with new schedules
    const updated = await prisma.medication.findUnique({
      where: { id },
      include: { schedules: true },
    });

    logger.info(`Medication updated with new schedules: ${updated.name}`);
    return updated;
  }

  logger.info(`Medication updated: ${medication.name}`);
  return medication;
}

/**
 * Delete a medication (cascades to schedules, reminders, etc.)
 */
async function remove(id, userId) {
  // Verify ownership
  const existing = await prisma.medication.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    const error = new Error('Medication not found or access denied.');
    error.statusCode = 404;
    throw error;
  }

  await prisma.medication.delete({ where: { id } });

  logger.info(`Medication deleted: ${existing.name} (${id})`);
  return { message: 'Medication deleted successfully.' };
}

module.exports = { create, getAll, getById, update, remove };
