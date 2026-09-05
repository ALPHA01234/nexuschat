const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/wav',
  'application/pdf', 'application/zip',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('That file type is not supported.'));
  cb(null, true);
}

// Global hard ceiling. The route applies the lower Free/Premium plan limit after auth.
const hardLimitMb = Math.max(Number(process.env.PREMIUM_UPLOAD_MB) || 100, 25);
const upload = multer({ storage, fileFilter, limits: { fileSize: hardLimitMb * 1024 * 1024, files: 1 } });

module.exports = { upload, UPLOAD_DIR };
