import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.ts';
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import type { Role } from '../core/const/roles.ts';

const ALGORITHM = 'HS256';

export interface AccessTokenPayload {
    sub: string;
    role: Role;
    /** User.tokenVersion at issue time; a mismatch means the token was invalidated. */
    tv: number;
}

export function signAccessToken(user: { id: number; role: Role; tokenVersion: number }): string {
    return jwt.sign({ role: user.role, tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
        algorithm: ALGORITHM,
        expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
        subject: String(user.id),
    });
}

/** Throws AppError(401) for any invalid, expired or malformed token. */
export function verifyAccessToken(token: string): AccessTokenPayload {
    try {
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
            algorithms: [ALGORITHM],
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
        });

        if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
            throw new Error('Malformed token payload');
        }

        return payload as unknown as AccessTokenPayload;
    } catch {
        throw new AppError(authMessages.INVALID_TOKEN, 401);
    }
}

/** Opaque 256-bit refresh token. Only its hash is stored. */
export function generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/** SHA-256 is enough here: the token is random and high-entropy, so no salt/bcrypt needed. */
export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}
