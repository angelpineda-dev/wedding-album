import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { createUserWithToken, resetDatabase } from './helpers.ts';

const validBody = (overrides: Record<string, unknown> = {}) => ({
    email: 'novios@test.local',
    name: 'Ana',
    lastName: 'Pérez',
    password: 'una-contraseña-segura',
    confirmedPassword: 'una-contraseña-segura',
    ...overrides,
});

const register = (auth: string | null, body: object) => {
    const req = request(app).post('/api/auth/register');
    if (auth) req.set('Authorization', auth);
    return req.send(body);
};

beforeEach(resetDatabase);
afterAll(() => db.close());

describe('POST /api/auth/register', () => {
    it('401 without a token', async () => {
        const res = await register(null, validBody());
        expect(res.status).toBe(401);
    });

    it('403 for a USER (client)', async () => {
        const { auth } = await createUserWithToken(ROLE.USER);
        const res = await register(auth, validBody());
        expect(res.status).toBe(403);
    });

    it('SUPER_ADMIN creates a USER by default and never returns the password', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        const res = await register(auth, validBody());

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ email: 'novios@test.local', name: 'Ana', lastName: 'Pérez', role: ROLE.USER });
        expect(res.body.data).not.toHaveProperty('password');

        const stored = await db.orm.public.User.where({ email: 'novios@test.local' }).first();
        expect(stored?.password).not.toBe('una-contraseña-segura');
    });

    it('SUPER_ADMIN can create another SUPER_ADMIN', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        const res = await register(auth, validBody({ role: ROLE.SUPER_ADMIN }));
        expect(res.status).toBe(201);
        expect(res.body.data.role).toBe(ROLE.SUPER_ADMIN);
    });

    it('ADMIN can create a USER', async () => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        const res = await register(auth, validBody({ role: ROLE.USER }));
        expect(res.status).toBe(201);
    });

    it.each([ROLE.SUPER_ADMIN, ROLE.ADMIN])('ADMIN cannot create a %s (403)', async (role) => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        const res = await register(auth, validBody({ role }));

        expect(res.status).toBe(403);
        expect(await db.orm.public.User.where({ email: 'novios@test.local' }).first()).toBeNull();
    });

    it('409 when the email is already registered', async () => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        expect((await register(auth, validBody())).status).toBe(201);

        const res = await register(auth, validBody({ name: 'Otra' }));
        expect(res.status).toBe(409);
    });

    it.each([
        ['an unknown field', { isVerified: true }],
        ['a server-managed field', { tokenVersion: 99 }],
        ['an injected role', { role: 'ROOT' }],
        ['a mismatched confirmation', { confirmedPassword: 'otra-cosa-distinta' }],
        ['a short password', { password: 'short', confirmedPassword: 'short' }],
    ])('400 with %s', async (_label, overrides) => {
        const { auth } = await createUserWithToken(ROLE.SUPER_ADMIN);
        const res = await register(auth, validBody(overrides));

        expect(res.status).toBe(400);
        expect(await db.orm.public.User.where({ email: 'novios@test.local' }).first()).toBeNull();
    });
});
