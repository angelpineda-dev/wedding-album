import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { registerUser, login as loginUser, refresh as refreshTokens } from '../services/authService.ts';
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

const register = async (req: Request, res: Response, next: NextFunction) => {
    try {

        const data = req.body;

        await registerUser(data);

        return res.status(201).send({
            message: 'User registered successfully'
        });

    } catch (error) {
        next(error);
    }
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
