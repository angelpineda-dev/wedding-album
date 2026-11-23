import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { login, logout, logoutAll, refresh, register, requestMagicLink, verifyMagicLink } from '../controllers/authController.ts';
import { authenticate, requireJson, requireRole } from '../middlewares/authMiddleware.ts';
import { env } from '../config/env.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { ROLE } from '../core/const/roles.ts';

// Per-IP limit. Complements the per-account lockout done in the login service.
// One limiter per route group so admin sign-ups and logins do not share a budget.
const authRateLimit = () => rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: authMessages.TOO_MANY_REQUESTS },
});

const authLimiter = authRateLimit();
const registerLimiter = authRateLimit();
const magicLinkLimiter = authRateLimit();

const router = express.Router();

// Only staff can create accounts; which roles each one may assign is decided in the controller.
router.post('/register', registerLimiter, authenticate, requireRole(ROLE.SUPER_ADMIN, ROLE.ADMIN), register);
router.post('/login', authLimiter, login);
// Client sign-in: request a link by email, then exchange its token for a session.
router.post('/magic-link', magicLinkLimiter, requireJson, requestMagicLink);
router.post('/magic-link/verify', magicLinkLimiter, requireJson, verifyMagicLink);
router.post('/refresh', authLimiter, requireJson, refresh);
router.post('/logout', requireJson, logout);
router.post('/logout-all', authenticate, logoutAll);

export default router;
