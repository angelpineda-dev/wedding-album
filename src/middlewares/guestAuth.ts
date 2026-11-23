import type { NextFunction, Request, Response } from 'express';
import AppError from '../errors/AppError.ts';
import { guestMessages } from '../core/userMessages/guest.ts';
import { findGuestByToken } from '../services/guestService.ts';

/**
 * Requires `Authorization: Bearer <guestToken>` (the token from `POST /public/events/:code/guests`).
 * Attaches the guest and its event; an expired token or a no-longer-enabled event is 401.
 */
export async function authenticateGuest(req: Request, _res: Response, next: NextFunction) {
    const [scheme, token] = req.get('Authorization')?.split(' ') ?? [];

    const guest = scheme === 'Bearer' && token ? await findGuestByToken(token) : null;

    if (!guest) {
        throw new AppError(guestMessages.INVALID_TOKEN, 401);
    }

    req.guest = { id: guest.id, name: guest.name, event: guest.event };

    next();
}
