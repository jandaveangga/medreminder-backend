/**
 * Role-based access control middleware factory
 * Usage: roleGuard('ADMIN', 'DOCTOR') — allows only ADMIN and DOCTOR roles
 * @param {...string} allowedRoles - List of allowed roles
 * @returns {Function} Express middleware
 */
function roleGuard(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${allowedRoles.join(', ')}. Your role: ${req.user.role}`,
      });
    }

    next();
  };
}

module.exports = roleGuard;
