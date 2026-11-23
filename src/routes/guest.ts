import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireJson } from '../middlewares/authMiddleware.ts';
import { authenticateGuest } from '../middlewares/guestAuth.ts';
import { env } from '../config/env.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { getMe, getMyMedia, postCompleteMedia, postMedia, postPresence } from '../controllers/guestController.ts';

// Per guest (not per IP: a whole venue may share one).
const uploadLimiter = rateLimit({
    windowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.UPLOAD_RATE_LIMIT_MAX,
    keyGenerator: (req) => req.guest!.id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: authMessages.TOO_MANY_REQUESTS },
});

const router = express.Router();

// Everything here acts as the guest of the Bearer token, inside that guest's event.
router.use(authenticateGuest);

router.get('/me', getMe);
router.post('/presence', requireJson, postPresence);

// Upload: 1) POST /media → presigned PUT URL; 2) PUT the file there; 3) POST /media/:id/complete.
router.post('/media', uploadLimiter, requireJson, postMedia);
router.post('/media/:id/complete', postCompleteMedia);
router.get('/media/mine', getMyMedia);

export default router;
