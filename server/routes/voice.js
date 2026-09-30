const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { transcribe, MAX_AUDIO_BYTES } = require('../controllers/voiceController');

const router = express.Router();
const acceptedTypes = new Set(['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp3']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 0 },
  fileFilter(req, file, callback) {
    if (!acceptedTypes.has(file.mimetype.split(';')[0].toLowerCase())) {
      const error = new Error('Choose a supported audio recording.');
      error.status = 415;
      error.expose = true;
      return callback(error);
    }
    callback(null, true);
  }
});

router.use(requireAuth);
router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.userId,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'voice_rate_limit', message: 'There have been too many voice requests. Give it a few minutes, then try again.' })
}));
router.post('/transcribe', (req, res, next) => {
  upload.single('audio')(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'audio_too_large', message: 'That recording is too long. Try a shorter voice message.' });
    if (error.status === 415) return res.status(415).json({ error: 'unsupported_audio', message: error.message });
    return res.status(400).json({ error: 'invalid_audio', message: 'I couldn’t read that recording. Try speaking again.' });
  });
}, asyncHandler(transcribe));

module.exports = router;
