import express from 'express';
import authRouter from './auth.ts';
import userRouter from './user.ts';
import adminRouter from './admin.ts';
import eventsRouter from './events.ts';
import publicRouter from './public.ts';
import guestRouter from './guest.ts';

// instance router
const router = express.Router();

// attach routes to router
router.use('/auth', authRouter);
router.use('/user', userRouter)
router.use('/admin', adminRouter);
router.use('/events', eventsRouter);
router.use('/public', publicRouter);
router.use('/guest', guestRouter);

export { router };