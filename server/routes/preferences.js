const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getPreferences, updatePreferences } = require('../controllers/preferencesController');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(getPreferences));
router.patch('/', asyncHandler(updatePreferences));

module.exports = router;
