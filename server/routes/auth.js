const express = require('express');
const { register, login, me, deleteAccount } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.get('/me', requireAuth, asyncHandler(me));
router.delete('/me', requireAuth, asyncHandler(deleteAccount));

module.exports = router;
