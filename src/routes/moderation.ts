import express from 'express';
import { authenticate, requireRole } from '../middlewares/authMiddleware.ts';
import { ROLE } from '../core/const/roles.ts';
import { getEventMedia, postApprove, postApproveAll, postHide } from '../controllers/moderationController.ts';

// Mounted at /events/:eventId/media. Role gate here; ownership (client) is checked per event.
const router = express.Router({ mergeParams: true });

router.use(authenticate, requireRole(ROLE.USER, ROLE.SUPER_ADMIN));

router.get('/', getEventMedia);
router.post('/approve-all', postApproveAll);
router.post('/:mediaId/approve', postApprove);
router.post('/:mediaId/hide', postHide);

export default router;
