import { and } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { env } from '../config/env.ts';
import { generateRefreshToken, hashToken } from './tokenService.ts';
import { mailService } from './mailService.ts';

const MINUTE_MS = 60 * 1000;

/** Path of the web app screen that receives the token and calls `POST /auth/magic-link/verify`. */
const MAGIC_LINK_PATH = '/auth/magic';

/** Creates a single-use link for the user and emails it. Earlier unused links stay valid until they expire. */
export async function sendMagicLink(user: { id: number; email: string }): Promise<void> {
    // Same 256-bit opaque token as refresh tokens: only its hash is stored.
    const token = generateRefreshToken();

    await db.orm.public.MagicLink.create({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + env.MAGIC_LINK_TTL_MINUTES * MINUTE_MS),
        usedAt: null,
    });

    const url = new URL(MAGIC_LINK_PATH, env.APP_PUBLIC_URL);
    url.searchParams.set('token', token);

    await mailService.sendMagicLink(user.email, url.toString());
}

/**
 * Marks the link as used and returns its user id, or null if it is unknown, used or expired.
 * One conditional UPDATE, so two concurrent requests with the same token cannot both succeed.
 */
export async function consumeMagicLink(token: string): Promise<number | null> {
    const now = new Date();

    const link = await db.orm.public.MagicLink
        .where((m) => and(m.tokenHash.eq(hashToken(token)), m.usedAt.isNull(), m.expiresAt.gt(now)))
        .update({ usedAt: now });

    return link?.userId ?? null;
}
