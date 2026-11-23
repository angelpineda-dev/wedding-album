import Router from 'express';
import { authenticate } from '../middlewares/authMiddleware.ts'
import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';

const router = Router();

router.get('/me', authenticate, async (req, res) => {
    const user = await db.orm.public.User
        .select('id', 'email', 'name', 'lastName', 'role', 'createdAt', 'updatedAt')
        .where({ id: req.user!.id })
        .first();

    if (!user) {
        throw new AppError(authMessages.INVALID_TOKEN, 401);
    }

    return res.json({ success: true, data: user });
})

export default router;
