import express from 'express';
import { authenticate, requireJson, requireRole } from '../middlewares/authMiddleware.ts';
import { ROLE } from '../core/const/roles.ts';
import {
    getClients,
    getDashboardStats,
    getEvents,
    patchClient,
    postEnableEvent,
    postSuspendEvent,
    resendClientInvitation,
} from '../controllers/adminController.ts';
import { getModerationQueue } from '../controllers/moderationController.ts';

const router = express.Router();

// Platform administration is SUPER_ADMIN only (ADMIN is reserved for moderation staff).
router.use(authenticate, requireRole(ROLE.SUPER_ADMIN));

router.get('/clients', getClients);
router.patch('/clients/:id', requireJson, patchClient);
router.post('/clients/:id/resend', resendClientInvitation);

router.get('/events', getEvents);
router.post('/events/:id/enable', requireJson, postEnableEvent);
router.post('/events/:id/suspend', postSuspendEvent);

router.get('/stats', getDashboardStats);
router.get('/moderation', getModerationQueue);

export default router;
