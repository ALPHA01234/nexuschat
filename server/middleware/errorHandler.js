const { validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Run at the top of a route after express-validator check(...) middlewares
// to return a clean 400 with the first validation error message.
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
}

// Final error-handling middleware — must be registered last in server.js.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error(err.stack || err.message || err);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(err.errors)[0]?.message || 'Validation error.' });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || { field: 1 })[0];
    return res.status(409).json({ message: `That ${field} is already taken.` });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid identifier.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Upload is too large.' });
  }

  const status = err.status || 500;
  res.status(status).json({ message: status === 500 ? 'Server error.' : err.message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Route not found.' });
}

module.exports = { handleValidation, errorHandler, notFoundHandler };
