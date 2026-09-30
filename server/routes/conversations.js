const express = require('express');
const { requireAuth } = require('../middleware/auth');
const conversationController = require('../controllers/conversationController');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(conversationController.list));
router.post('/', asyncHandler(conversationController.create));
router.get('/:id/messages', asyncHandler(conversationController.getMessages));
router.delete('/:id', asyncHandler(conversationController.remove));

module.exports = router;
