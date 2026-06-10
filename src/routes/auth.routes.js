const express = require('express');
const { body } = require('express-validator');
const authService = require('../services/auth.service');
const authMiddleware = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post(
  '/register',
  validate([
    body('name').trim().notEmpty().withMessage('Name is required.')
      .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters.'),
    body('email').trim().isEmail().withMessage('Valid email is required.')
      .normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone number is required.')
      .matches(/^\+?[\d\s\-()]{7,20}$/).withMessage('Valid phone number is required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('role').optional().isIn(['USER', 'CAREGIVER']).withMessage('Role must be USER or CAREGIVER.'),
  ]),
  async (req, res, next) => {
    try {
      const { name, email, phone, password, role } = req.body;
      const result = await authService.register({ name, email, phone, password, role });
      res.status(201).json({
        success: true,
        message: 'Registration successful.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post(
  '/login',
  validate([
    body('email').trim().isEmail().withMessage('Valid email is required.').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required.'),
  ]),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login({ email, password });
      res.json({
        success: true,
        message: 'Login successful.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id);
    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/auth/profile
 * Update current user profile
 */
router.put(
  '/profile',
  authMiddleware,
  validate([
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('phone').optional().trim().matches(/^\+?[\d\s\-()]{7,20}$/),
    body('currentPassword').optional().isString(),
    body('newPassword').optional().isLength({ min: 6 }),
  ]),
  async (req, res, next) => {
    try {
      const user = await authService.updateProfile(req.user.id, req.body);
      res.json({
        success: true,
        message: 'Profile updated successfully.',
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/auth/profile-picture
 * Upload a profile picture to Cloudinary
 */
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

router.post(
  '/profile-picture',
  authMiddleware,
  upload.single('avatar'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided.' });
      }

      // Upload to Cloudinary via stream
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'medreminder/avatars',
            public_id: `user_${req.user.id}`,
            overwrite: true,
            transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });

      // Save URL to database
      const prisma = require('../config/database');
      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: result.secure_url },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
        },
      });

      res.json({
        success: true,
        message: 'Profile picture updated.',
        data: { avatarUrl: user.avatarUrl },
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
