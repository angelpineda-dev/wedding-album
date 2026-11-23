import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { db } from '../prisma/db.ts'
import type { User } from "../types/auth.ts"
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { env } from '../config/env.ts';
import { signAccessToken } from './tokenService.ts';
import { createSession, rotateSession, ROTATION, type SessionMeta } from './sessionService.ts';

const registerUser = async (data: User) => {

    const { password, confirmed_password, ...newData } = data;

    const isPasswordMatch = password === confirmed_password;

    if (!isPasswordMatch || !password || !confirmed_password) {
        throw new AppError(authMessages.CONFIRM_PASSWORD);
    }

    try {
        const hashedPassword = await bcrypt.hash(password, env.BCRYPT_COST);

        const user = await db.orm.public.User.select('id').create({
            ...newData,
            password: hashedPassword
        });

        if (!user) {
            throw new AppError(authMessages.ERROR_SAVING_USER, 500)
        }

        return user;
    } catch (error) {
        throw new AppError(authMessages.ERROR_SAVING_USER, 500)
    }

}

// Hash compared when the user does not exist, is deleted or is locked,
// so every failed login costs the same time (prevents user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), env.BCRYPT_COST);

const MINUTE_MS = 60 * 1000;

type UserRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.User.first>>>;

/** User fields safe to send to clients. */
const toPublicUser = (user: UserRow) => {
    const { password, tokenVersion, failedLoginAttempts, lockedUntil, deletedAt, ...publicUser } = user;
    return publicUser;
};

const issueTokens = (user: UserRow, refreshToken: string) => ({
    accessToken: signAccessToken(user),
    refreshToken,
    user: toPublicUser(user),
});

const login = async (email: string, password: string, meta: SessionMeta) => {
    const invalidCredentials = new AppError(authMessages.INVALID_CREDENTIALS, 401);
    const user = await db.orm.public.User.where({ email }).first();

    const isBlocked = !user || user.deletedAt !== null || (user.lockedUntil !== null && user.lockedUntil > new Date());

    if (isBlocked) {
        await bcrypt.compare(password, DUMMY_HASH);
        throw invalidCredentials;
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
        const attempts = user.failedLoginAttempts + 1;
        const shouldLock = attempts >= env.LOGIN_MAX_ATTEMPTS;

        await db.orm.public.User.where({ id: user.id }).update({
            failedLoginAttempts: shouldLock ? 0 : attempts,
            lockedUntil: shouldLock ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * MINUTE_MS) : null,
        });

        throw invalidCredentials;
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil !== null) {
        await db.orm.public.User.where({ id: user.id }).update({ failedLoginAttempts: 0, lockedUntil: null });
    }

    const refreshToken = await createSession(user.id, meta);

    return issueTokens(user, refreshToken);
}

const refresh = async (refreshToken: string, meta: SessionMeta) => {
    const result = await rotateSession(refreshToken, meta);

    switch (result.kind) {
        case ROTATION.OK:
            return issueTokens(result.user, result.refreshToken);
        case ROTATION.INVALID:
        case ROTATION.REUSED:
            throw new AppError(authMessages.INVALID_REFRESH_TOKEN, 401);
        default: {
            const unhandled: never = result;
            throw new Error(`Unhandled rotation result: ${JSON.stringify(unhandled)}`);
        }
    }
}

export {
    registerUser,
    login,
    refresh
}