import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, logout, logoutAll, refresh, register } from '../controllers/authController.ts';
import { authenticate, requireJson } from '../middlewares/authMiddleware.ts';
import { env } from '../config/env.ts';
import { authMessages } from '../core/userMessages/auth.ts';

// Per-IP limit. Complements the per-account lockout done in the login service.
const authLimiter = rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: authMessages.TOO_MANY_REQUESTS },
});

const router = express.Router();

router.post('/register', register);
router.post('/login', authLimiter, login);
router.post('/refresh', authLimiter, requireJson, refresh);
router.post('/logout', requireJson, logout);
router.post('/logout-all', authenticate, logoutAll);

export default router;
