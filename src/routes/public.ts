import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireJson } from '../middlewares/authMiddleware.ts';
import { env } from '../config/env.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { getPublicEvent, postJoin } from '../controllers/guestController.ts';

// Per-IP: a whole wedding may share one Wi-Fi, so the budget is generous but stops code guessing.
const publicLimiter = rateLimit({
    windowMs: env.PUBLIC_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.PUBLIC_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: authMessages.TOO_MANY_REQUESTS },
});

const router = express.Router();

router.use(publicLimiter);

router.get('/events/:code', getPublicEvent);
router.post('/events/:code/guests', requireJson, postJoin);

export default router;
