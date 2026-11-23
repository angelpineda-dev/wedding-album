import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { createUserWithToken, mockMail, resetDatabase, sentMagicLinks } from './helpers.ts';

const EMAIL = 'novios@test.local';

const clientBody = (overrides: Record<string, unknown> = {}) => ({
    email: EMAIL,
    name: 'Ana',
    lastName: 'Pérez',
    ...overrides,
});

const staffBody = (overrides: Record<string, unknown> = {}) => ({
    email: EMAIL,
    name: 'Moderadora',
    password: 'una-contraseña-segura',
    confirmedPassword: 'una-contraseña-segura',
    role: ROLE.ADMIN,
    ...overrides,
});

const register = (auth: string | null, body: object) => {
    const req = request(app).post('/api/auth/register');
    if (auth) req.set('Authorization', auth);
    return req.send(body);
};

const storedUser = () => db.orm.public.User.where({ email: EMAIL }).first();

let mail: ReturnType<typeof mockMail>;

beforeEach(async () => {
    await resetDatabase();
    mail = mockMail();
});
afterAll(() => db.close());

describe('POST /api/auth/register', () => {
    it('401 without a token', async () => {
        const res = await register(null, clientBody());
        expect(res.status).toBe(401);
    });

    it('403 for a USER (client)', async () => {
        const { auth } = await createUserWithToken(ROLE.USER);
        const res = await register(auth, clientBody());
        expect(res.status).toBe(403);
    });

    it('creates a client without password, with quota, and emails a magic link', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        mail.mockClear();

        const res = await register(auth, clientBody({ eventQuota: 3 }));

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ email: EMAIL, name: 'Ana', lastName: 'Pérez', role: ROLE.USER, eventQuota: 3 });
        expect(res.body.data).not.toHaveProperty('password');
        expect((await storedUser())?.password).toBeNull();
        expect(sentMagicLinks(mail).map((link) => link.to)).toEqual([EMAIL]);
    });

    it('client quota defaults to 1', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        const res = await register(auth, clientBody());
        expect(res.body.data.eventQuota).toBe(1);
    });

    it('ADMIN can create a client', async () => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        const res = await register(auth, clientBody({ role: ROLE.USER }));
        expect(res.status).toBe(201);
    });

    it('SUPER_ADMIN creates staff with a hashed password and no magic link', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        mail.mockClear();

        const res = await register(auth, staffBody({ role: ROLE.SUPER_ADMIN }));

        expect(res.status).toBe(201);
        expect(res.body.data.role).toBe(ROLE.SUPER_ADMIN);
        const stored = await storedUser();
        expect(stored?.password).toBeTruthy();
        expect(stored?.password).not.toBe('una-contraseña-segura');
        expect(mail).not.toHaveBeenCalled();
    });

    it.each([ROLE.SUPER_ADMIN, ROLE.ADMIN])('ADMIN cannot create a %s (403)', async (role) => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        const res = await register(auth, staffBody({ role }));

        expect(res.status).toBe(403);
        expect(await storedUser()).toBeNull();
    });

    it('409 when the email is already registered', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        expect((await register(auth, clientBody())).status).toBe(201);

        const res = await register(auth, clientBody({ name: 'Otra' }));
        expect(res.status).toBe(409);
    });

    it.each([
        ['an unknown field', clientBody({ isVerified: true })],
        ['a server-managed field', clientBody({ tokenVersion: 99 })],
        ['an injected role', clientBody({ role: 'ROOT' })],
        ['a password for a client', clientBody({ password: 'una-contraseña-segura', confirmedPassword: 'una-contraseña-segura' })],
        ['a quota out of range', clientBody({ eventQuota: 0 })],
        ['staff without password', staffBody({ password: undefined, confirmedPassword: undefined })],
        ['staff with a mismatched confirmation', staffBody({ confirmedPassword: 'otra-cosa-distinta' })],
        ['staff with a password under 12 characters', staffBody({ password: 'corta-11ch', confirmedPassword: 'corta-11ch' })],
        ['staff with a quota', staffBody({ eventQuota: 2 })],
    ])('400 with %s', async (_label, body) => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        const res = await register(auth, body);

        expect(res.status).toBe(400);
        expect(await storedUser()).toBeNull();
    });
});
