import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.ts';

/**
 * Same API for SPA and mobile clients, chosen per request:
 * - SPA (default): refresh token lives in an httpOnly cookie, never in the body (not readable by JS → XSS-safe).
 * - Mobile (`X-Client-Type: mobile`): refresh token travels in the JSON body; the app keeps it in Keychain/Keystore.
 */
export const CLIENT_TYPE = {
    WEB: 'web',
    MOBILE: 'mobile',
} as const;

const CLIENT_TYPE_HEADER = 'X-Client-Type';
const REFRESH_COOKIE = 'refreshToken';
const DAY_MS = 24 * 60 * 60 * 1000;

const isMobile = (req: Request) => req.get(CLIENT_TYPE_HEADER)?.toLowerCase() === CLIENT_TYPE.MOBILE;

// Scoped to the auth router (e.g. /api/auth) so the cookie is not sent with every API call.
const cookieOptions = (req: Request): CookieOptions => ({
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: req.baseUrl,
});

export function readRefreshToken(req: Request): string | undefined {
    const token: unknown = isMobile(req) ? req.body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** Sets the cookie (SPA) or returns `{ refreshToken }` to merge into the response body (mobile). */
export function deliverRefreshToken(req: Request, res: Response, refreshToken: string): { refreshToken?: string } {
    if (isMobile(req)) {
        return { refreshToken };
    }

    res.cookie(REFRESH_COOKIE, refreshToken, {
        ...cookieOptions(req),
        maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
    });

    return {};
}

export function clearRefreshToken(req: Request, res: Response): void {
    if (!isMobile(req)) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions(req));
    }
}
