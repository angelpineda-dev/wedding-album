import express from 'express';
import authRouter from './auth.ts';
import userRouter from './user.ts';
import adminRouter from './admin.ts';

// instance router
const router = express.Router();

// attach routes to router
router.use('/auth', authRouter);
router.use('/user', userRouter)
router.use('/admin', adminRouter);

export { router };