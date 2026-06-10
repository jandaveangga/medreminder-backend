const express = require('express');
const { body, param, query } = require('express-validator');
const adminService = require('../services/admin.service');
const authMiddleware = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const validate = require('../middleware/validate');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

/**
 * GET /api/admin/users
 * Get all users with optional filters (Admin only)
 */
router.get(
  '/users',
  roleGuard(['ADMIN']),
  validate([
    query('role').optional().isIn(['USER', 'CAREGIVER', 'DOCTOR', 'ADMIN']).withMessage('Invalid role.'),
    query('search').optional().trim().isString(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ]),
  async (req, res, next) => {
    try {
      const { role, search, page, limit } = req.query;
      const result = await adminService.getAllUsers({
        role,
        search,
        page: page || 1,
        limit: limit || 20,
      });
      res.json({
        success: true,
        data: result.users,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/users/:id
 * Get specific user details, medications, caregivers, and links (Admin/Doctor)
 */
router.get(
  '/users/:id',
  roleGuard(['ADMIN', 'DOCTOR']),
  validate([
    param('id').isUUID().withMessage('Invalid user ID.'),
  ]),
  async (req, res, next) => {
    try {
      const user = await adminService.getUserById(req.params.id);
      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/admin/users/:id/role
 * Update user's system role (Admin only)
 */
router.put(
  '/users/:id/role',
  roleGuard(['ADMIN']),
  validate([
    param('id').isUUID().withMessage('Invalid user ID.'),
    body('role').isIn(['USER', 'CAREGIVER', 'DOCTOR', 'ADMIN']).withMessage('Role must be USER, CAREGIVER, DOCTOR, or ADMIN.'),
  ]),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const updatedUser = await adminService.updateUserRole(id, role);
      res.json({
        success: true,
        message: 'User role updated successfully.',
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/stats
 * Get system-wide statistics (Admin only)
 */
router.get('/stats', roleGuard(['ADMIN']), async (req, res, next) => {
  try {
    const stats = await adminService.getSystemStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/escalations
 * Get all active/recent escalations (Admin/Doctor)
 */
router.get(
  '/escalations',
  roleGuard(['ADMIN', 'DOCTOR']),
  validate([
    query('level').optional().isIn(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5']).withMessage('Invalid level.'),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ]),
  async (req, res, next) => {
    try {
      const { level, page, limit } = req.query;
      const result = await adminService.getAllEscalations({
        level,
        page: page || 1,
        limit: limit || 20,
      });
      res.json({
        success: true,
        data: result.escalations,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
