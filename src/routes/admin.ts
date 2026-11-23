import express from 'express';
import { authenticate, requireJson, requireRole } from '../middlewares/authMiddleware.ts';
import { ROLE } from '../core/const/roles.ts';
import { getClients, patchClient, resendClientInvitation } from '../controllers/adminController.ts';

const router = express.Router();

// Platform administration is SUPER_ADMIN only (ADMIN is reserved for moderation staff).
router.use(authenticate, requireRole(ROLE.SUPER_ADMIN));

router.get('/clients', getClients);
router.patch('/clients/:id', requireJson, patchClient);
router.post('/clients/:id/resend', resendClientInvitation);

export default router;
