const express = require('express');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const goalController = require('../controllers/goalController');

const router = express.Router();
router.use(requireAuth);
router.get('/', asyncHandler(goalController.list));
router.post('/', asyncHandler(goalController.create));
router.patch('/:id', asyncHandler(goalController.update));
router.delete('/:id', asyncHandler(goalController.remove));

module.exports = router;
