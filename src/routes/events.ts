import express from 'express';
import { authenticate, requireJson, requireRole } from '../middlewares/authMiddleware.ts';
import { ROLE } from '../core/const/roles.ts';
import { getEvent, getEvents, patchEvent, postEvent } from '../controllers/eventController.ts';

const router = express.Router();

// A client's own events. Each handler scopes by `req.user.id`, so other clients' events are 404.
router.use(authenticate, requireRole(ROLE.USER));

router.get('/', getEvents);
router.post('/', requireJson, postEvent);
router.get('/:id', getEvent);
router.patch('/:id', requireJson, patchEvent);

export default router;
