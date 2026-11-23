import express from 'express';
import { requireJson } from '../middlewares/authMiddleware.ts';
import { authenticateGuest } from '../middlewares/guestAuth.ts';
import { getMe, postPresence } from '../controllers/guestController.ts';

const router = express.Router();

// Everything here acts as the guest of the Bearer token, inside that guest's event.
router.use(authenticateGuest);

router.get('/me', getMe);
router.post('/presence', requireJson, postPresence);

export default router;
