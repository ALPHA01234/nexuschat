// Express 5 makes req.query a getter-only property, so the popular
// express-mongo-sanitize package (which tries to reassign it) breaks here.
// This does the part that actually matters for us: recursively stripping
// Mongo operator keys ($gt, $where, ...) and dotted keys out of anything
// the client controls that reaches a query (req.body, req.params).
function stripDangerousKeys(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(stripDangerousKeys);
    return obj;
  }
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key];
        continue;
      }
      stripDangerousKeys(obj[key]);
    }
  }
  return obj;
}

function sanitizeInput(req, res, next) {
  if (req.body) stripDangerousKeys(req.body);
  if (req.params) stripDangerousKeys(req.params);
  next();
}

module.exports = { sanitizeInput, stripDangerousKeys };
