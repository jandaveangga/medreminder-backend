const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Sign a JWT token with user payload
 * @param {Object} payload - { userId, email, role }
 * @returns {string} JWT token
 */
function signToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * Verify and decode a JWT token
 * @param {string} token
 * @returns {Object} Decoded payload
 */
function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };
