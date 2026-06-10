const prisma = require('../config/database');
const { hashPassword, comparePassword } = require('../utils/hash');
const { signToken } = require('../utils/jwt');
const logger = require('../utils/logger');

/**
 * Register a new user
 */
async function register({ name, email, phone, password, role = 'USER' }) {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const error = new Error('A user with this email already exists.');
    error.statusCode = 409;
    throw error;
  }

  // Only allow USER role during self-registration
  // ADMIN/DOCTOR/CAREGIVER roles must be assigned by an admin
  const allowedSelfRoles = ['USER', 'CAREGIVER'];
  const assignedRole = allowedSelfRoles.includes(role) ? role : 'USER';

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      passwordHash,
      role: assignedRole,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      mustChangePassword: true,
      avatarUrl: true,
      createdAt: true,
    },
  });

  // Generate JWT token
  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  logger.success(`User registered: ${user.email} (${user.role})`);

  return { token, user };
}

/**
 * Login with email and password
 */
async function login({ email, password }) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (!user) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  const isPasswordValid = await comparePassword(password, user.passwordHash);
  if (!isPasswordValid) {
    const error = new Error('Invalid email or password.');
    error.statusCode = 401;
    throw error;
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const userData = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    avatarUrl: user.avatarUrl,
  };

  logger.info(`User logged in: ${user.email}`);

  return { token, user: userData };
}

/**
 * Get user profile by ID
 */
async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      mustChangePassword: true,
      avatarUrl: true,
      createdAt: true,
      updatedAt: true,
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
 * Update user profile
 */
async function updateProfile(userId, data) {
  const updateData = {};

  if (data.name) updateData.name = data.name.trim();
  if (data.phone) updateData.phone = data.phone.trim();

  // Handle password change
  if (data.newPassword) {
    if (!data.currentPassword) {
      const error = new Error('Current password is required to change password.');
      error.statusCode = 400;
      throw error;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isValid = await comparePassword(data.currentPassword, user.passwordHash);
    if (!isValid) {
      const error = new Error('Current password is incorrect.');
      error.statusCode = 400;
      throw error;
    }

    updateData.passwordHash = await hashPassword(data.newPassword);
    updateData.mustChangePassword = false;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      mustChangePassword: true,
      avatarUrl: true,
      updatedAt: true,
    },
  });

  logger.info(`Profile updated: ${user.email}`);

  return user;
}

module.exports = { register, login, getProfile, updateProfile };
