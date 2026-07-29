const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

function kindFromMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

// POST /api/uploads — multipart/form-data, field name "file"
// Returns attachment metadata to embed in a message (type: 'attachment').
router.post(
  '/',
  requireAuth,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Upload failed.' });
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file provided.' });

    res.status(201).json({
      attachment: {
        url: `/uploads/${req.file.filename}`,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        kind: kindFromMime(req.file.mimetype),
      },
    });
  })
);

module.exports = router;
