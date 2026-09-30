const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { sendMessage } = require('../controllers/chatController');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.post('/', requireAuth, asyncHandler(sendMessage));

module.exports = router;
