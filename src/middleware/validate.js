const { validationResult } = require('express-validator');

/**
 * Express-validator middleware wrapper
 * Runs validation chains and returns 400 with errors if validation fails
 * @param {Array} validations - Array of express-validator validation chains
 * @returns {Function} Express middleware
 */
function validate(validations) {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const extractedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: extractedErrors,
    });
  };
}

module.exports = validate;
