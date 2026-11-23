import crypto from 'node:crypto';
import { and } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { env } from '../config/env.ts';
import { generateRefreshToken, hashToken } from './tokenService.ts';

type Orm = typeof db.orm;

export interface SessionMeta {
    userAgent?: string | undefined;
    ip?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const refreshExpiry = () => new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS);

/**
 * Creates a session row and returns the raw refresh token (never stored).
 * `familyId` groups every token produced by rotating the same login.
 */
export async function createSession(
    userId: number,
    meta: SessionMeta,
    familyId: string = crypto.randomUUID(),
    orm: Orm = db.orm,
): Promise<string> {
    const refreshToken = generateRefreshToken();

    await orm.public.Session.create({
        userId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiry(),
        revokedAt: null,
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip ?? null,
    });

    return refreshToken;
}

/**
 * Revokes every active session of the user and bumps `tokenVersion`,
 * so access tokens already issued stop working too.
 */
export async function revokeAllSessions(userId: number, orm: Orm = db.orm): Promise<void> {
    const now = new Date();

    await orm.public.Session
        .where((s) => and(s.userId.eq(userId), s.revokedAt.isNull()))
        .updateAll({ revokedAt: now });

    const user = await orm.public.User.where({ id: userId }).first();
    if (user) {
        await orm.public.User.where({ id: userId }).update({ tokenVersion: user.tokenVersion + 1 });
    }
}

/** Revokes the session of a refresh token. Idempotent: unknown or revoked tokens are ignored. */
export async function revokeSession(refreshToken: string): Promise<void> {
    await db.orm.public.Session
        .where((s) => and(s.tokenHash.eq(hashToken(refreshToken)), s.revokedAt.isNull()))
        .updateAll({ revokedAt: new Date() });
}

export const ROTATION = {
    OK: 'OK',
    INVALID: 'INVALID',
    REUSED: 'REUSED',
} as const;

type User = NonNullable<Awaited<ReturnType<typeof db.orm.public.User.first>>>;

export type RotationResult =
    | { kind: typeof ROTATION.OK; user: User; refreshToken: string }
    | { kind: typeof ROTATION.INVALID }
    | { kind: typeof ROTATION.REUSED };

/**
 * Refresh-token rotation: the presented token is revoked and a new one is issued
 * in the same family. Presenting an already revoked token means it was stolen
 * (or replayed): every session of the user is revoked.
 *
 * Never throws for business outcomes so the transaction commits the revocations.
 */
export async function rotateSession(refreshToken: string, meta: SessionMeta): Promise<RotationResult> {
    const tokenHash = hashToken(refreshToken);

    return db.transaction(async (tx): Promise<RotationResult> => {
        const session = await tx.orm.public.Session.where({ tokenHash }).forUpdate().first();

        if (!session) {
            return { kind: ROTATION.INVALID };
        }

        if (session.revokedAt) {
            await revokeAllSessions(session.userId, tx.orm);
            return { kind: ROTATION.REUSED };
        }

        const now = new Date();

        await tx.orm.public.Session.where({ id: session.id }).update({ revokedAt: now });

        if (session.expiresAt <= now) {
            return { kind: ROTATION.INVALID };
        }

        const user = await tx.orm.public.User.where({ id: session.userId }).first();

        if (!user || user.deletedAt) {
            return { kind: ROTATION.INVALID };
        }

        const newToken = await createSession(user.id, meta, session.familyId, tx.orm);

        return { kind: ROTATION.OK, user, refreshToken: newToken };
    });
}
