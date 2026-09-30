const express = require('express');
const { requireAuth } = require('../middleware/auth');
const memoryController = require('../controllers/memoryController');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(memoryController.list));
router.post('/', asyncHandler(memoryController.create));
router.patch('/:id', asyncHandler(memoryController.update));
router.delete('/:id', asyncHandler(memoryController.remove));
router.delete('/', asyncHandler(memoryController.clearAll));

module.exports = router;
