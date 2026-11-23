import type { Request, Response } from 'express';
import { z } from 'zod';
import { canAssignRole, createUser, login as loginUser, refresh as refreshTokens } from '../services/authService.ts';
import { ROLE } from '../core/const/roles.ts';
import { revokeAllSessions, revokeSession, type SessionMeta } from '../services/sessionService.ts';
import { clearRefreshToken, deliverRefreshToken, readRefreshToken } from '../utils/refreshTransport.ts';
import { env } from '../config/env.ts';
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';

const loginSchema = z.object({
    email: z.email().max(254),
    // bcrypt only uses the first 72 bytes; cap length to avoid hashing huge inputs.
    password: z.string().min(1).max(128),
});

const sessionMeta = (req: Request): SessionMeta => ({
    userAgent: req.get('User-Agent'),
    ip: req.ip,
});

type IssuedTokens = Awaited<ReturnType<typeof loginUser>>;

const sendTokens = (req: Request, res: Response, { accessToken, refreshToken, user }: IssuedTokens) =>
    res.status(200).json({
        success: true,
        data: {
            tokenType: 'Bearer',
            accessToken,
            expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
            ...deliverRefreshToken(req, res, refreshToken),
            user,
        },
    });

// Strict: unknown keys are rejected (400) instead of silently reaching the ORM.
const registerSchema = z.strictObject({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(8).max(128),
    confirmedPassword: z.string(),
    role: z.enum(ROLE).default(ROLE.USER),
}).refine((data) => data.password === data.confirmedPassword, {
    message: authMessages.CONFIRM_PASSWORD,
    path: ['confirmedPassword'],
});

const register = async (req: Request, res: Response) => {
    const { email, name, lastName, password, role } = registerSchema.parse(req.body);

    if (!canAssignRole(req.user!.role, role)) {
        throw new AppError(authMessages.ROLE_NOT_ALLOWED, 403);
    }

    const user = await createUser({ email, name, lastName: lastName ?? null, password, role });

    return res.status(201).json({ success: true, data: user });
};

const login = async (req: Request, res: Response) => {
    const { email, password } = loginSchema.parse(req.body);

    const tokens = await loginUser(email, password, sessionMeta(req));

    return sendTokens(req, res, tokens);
};

const refresh = async (req: Request, res: Response) => {
    const refreshToken = readRefreshToken(req);

    if (!refreshToken) {
        throw new AppError(authMessages.INVALID_REFRESH_TOKEN, 401);
    }

    try {
        const tokens = await refreshTokens(refreshToken, sessionMeta(req));
        return sendTokens(req, res, tokens);
    } catch (error) {
        clearRefreshToken(req, res);
        throw error;
    }
};

const logout = async (req: Request, res: Response) => {
    const refreshToken = readRefreshToken(req);

    if (refreshToken) {
        await revokeSession(refreshToken);
    }

    clearRefreshToken(req, res);

    return res.status(204).end();
};

const logoutAll = async (req: Request, res: Response) => {
    await revokeAllSessions(req.user!.id);

    clearRefreshToken(req, res);

    return res.status(204).end();
};

export { register, login, refresh, logout, logoutAll };
