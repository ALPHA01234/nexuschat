const express = require('express');
const fs = require('fs');
const { requireAuth, requireUnrestricted } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();

function kindFromMime(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

router.post('/', requireAuth, requireUnrestricted,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message || 'Upload failed.' });
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file provided.' });

    const premium = req.user.hasPremium();
    const freeMb = Math.max(Number(process.env.FREE_UPLOAD_MB) || 10, 1);
    const premiumMb = Math.max(Number(process.env.PREMIUM_UPLOAD_MB) || 100, freeMb);
    const allowedBytes = (premium ? premiumMb : freeMb) * 1024 * 1024;

    if (req.file.size > allowedBytes) {
      fs.unlink(req.file.path, () => {});
      return res.status(413).json({
        message: premium
          ? `Premium uploads are limited to ${premiumMb} MB per file.`
          : `Free accounts can upload up to ${freeMb} MB per file. Premium supports up to ${premiumMb} MB.`,
        limitMb: premium ? premiumMb : freeMb,
      });
    }

    res.status(201).json({
      attachment: {
        url: `/uploads/${req.file.filename}`,
        filename: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        kind: kindFromMime(req.file.mimetype),
      },
      plan: premium ? 'premium' : 'free',
      limitMb: premium ? premiumMb : freeMb,
    });
  })
);

module.exports = router;
