import express from 'express';
import authRouter from './auth.ts';
import userRouter from './user.ts';
import adminRouter from './admin.ts';
import eventsRouter from './events.ts';

// instance router
const router = express.Router();

// attach routes to router
router.use('/auth', authRouter);
router.use('/user', userRouter)
router.use('/admin', adminRouter);
router.use('/events', eventsRouter);

export { router };