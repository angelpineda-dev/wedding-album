import type { Request, Response, NextFunction } from 'express'
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { verifyAccessToken } from '../services/tokenService.ts';
import { db } from '../prisma/db.ts';
import type { Role } from '../core/const/roles.ts';
import { USER_STATUS } from '../core/const/userStatus.ts';

/**
 * Requires `Authorization: Bearer <accessToken>`.
 * Loads the user so deleted or suspended users and invalidated tokens (tokenVersion bump) are rejected immediately.
 */
async function authenticate(req: Request, _res: Response, next: NextFunction) {
    const [scheme, token] = req.get('Authorization')?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
        throw new AppError(authMessages.UNAUTHORIZED, 401);
    }

    const payload = verifyAccessToken(token);
    const userId = Number(payload.sub);

    const user = Number.isInteger(userId)
        ? await db.orm.public.User.select('id', 'role', 'status', 'tokenVersion', 'deletedAt').where({ id: userId }).first()
        : null;

    if (!user || user.deletedAt !== null || user.status !== USER_STATUS.ACTIVE || user.tokenVersion !== payload.tv) {
        throw new AppError(authMessages.INVALID_TOKEN, 401);
    }

    req.user = { id: user.id, role: user.role };

    next();
}

/**
 * Allows the request only if the authenticated user has one of `roles`.
 * Must run after `authenticate`.
 */
function requireRole(...roles: Role[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) {
            throw new AppError(authMessages.UNAUTHORIZED, 401);
        }

        if (!roles.includes(req.user.role)) {
            throw new AppError(authMessages.FORBIDDEN, 403);
        }

        next();
    };
}

/**
 * CSRF defense in depth for cookie-authenticated endpoints: a cross-site HTML form
 * cannot send `application/json`, and a cross-origin fetch with it triggers a CORS preflight.
 */
function requireJson(req: Request, _res: Response, next: NextFunction) {
    if (!req.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
        throw new AppError(authMessages.UNSUPPORTED_MEDIA_TYPE, 415);
    }

    next();
}

export { authenticate, requireRole, requireJson };
