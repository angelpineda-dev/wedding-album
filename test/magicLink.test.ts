import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { USER_STATUS } from '../src/core/const/userStatus.ts';
import { createUserWithToken, mockMail, resetDatabase, sentMagicLinks, STAFF_PASSWORD } from './helpers.ts';

const requestLink = (email: string) => request(app).post('/api/auth/magic-link').send({ email });
const verify = (token: string, headers: Record<string, string> = {}) =>
    request(app).post('/api/auth/magic-link/verify').set(headers).send({ token });

let mail: ReturnType<typeof mockMail>;

beforeEach(async () => {
    await resetDatabase();
    mail = mockMail();
});
afterAll(() => db.close());

/** A client plus the token of the invitation link it got on creation. */
async function clientWithLink() {
    const { user } = await createUserWithToken(ROLE.USER);
    const link = sentMagicLinks(mail).at(-1)!;
    return { user, token: link.token };
}

describe('POST /api/auth/magic-link', () => {
    it('emails a link to an active client (202)', async () => {
        const { user } = await clientWithLink();
        mail.mockClear();

        const res = await requestLink(user.email);

        expect(res.status).toBe(202);
        expect(sentMagicLinks(mail).map((link) => link.to)).toEqual([user.email]);
    });

    it('answers 202 and sends nothing for an unknown email', async () => {
        const res = await requestLink('nadie@test.local');

        expect(res.status).toBe(202);
        expect(mail).not.toHaveBeenCalled();
    });

    it('sends nothing to staff (they use a password)', async () => {
        const { user } = await createUserWithToken(ROLE.SUPER_ADMIN);

        const res = await requestLink(user.email);

        expect(res.status).toBe(202);
        expect(mail).not.toHaveBeenCalled();
    });

    it('sends nothing to a suspended client', async () => {
        const { user } = await clientWithLink();
        await db.orm.public.User.where({ id: user.id }).update({ status: USER_STATUS.SUSPENDED });
        mail.mockClear();

        expect((await requestLink(user.email)).status).toBe(202);
        expect(mail).not.toHaveBeenCalled();
    });

    it('415 without a JSON body', async () => {
        const res = await request(app).post('/api/auth/magic-link').type('form').send('email=a@test.local');
        expect(res.status).toBe(415);
    });
});

describe('POST /api/auth/magic-link/verify', () => {
    it('signs the client in once: access token + refresh cookie, then the link is spent', async () => {
        const { user, token } = await clientWithLink();

        const res = await verify(token);

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toBeTruthy();
        expect(res.body.data.user).toMatchObject({ id: user.id, role: ROLE.USER });
        expect(res.body.data.user).not.toHaveProperty('password');
        expect(res.headers['set-cookie']?.[0]).toMatch(/^refreshToken=.+HttpOnly/);

        const me = await request(app).get('/api/user/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
        expect(me.status).toBe(200);

        expect((await verify(token)).status).toBe(401);
    });

    it('returns the refresh token in the body for mobile clients', async () => {
        const { token } = await clientWithLink();

        const res = await verify(token, { 'X-Client-Type': 'mobile' });

        expect(res.status).toBe(200);
        expect(res.body.data.refreshToken).toBeTruthy();
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('401 for an expired link', async () => {
        const { user, token } = await clientWithLink();
        await db.orm.public.MagicLink.where({ userId: user.id }).updateAll({ expiresAt: new Date(Date.now() - 1000) });

        expect((await verify(token)).status).toBe(401);
    });

    it('401 for an unknown token', async () => {
        expect((await verify('not-a-real-token')).status).toBe(401);
    });

    it('401 when the client was suspended after the link was sent', async () => {
        const { user, token } = await clientWithLink();
        await db.orm.public.User.where({ id: user.id }).update({ status: USER_STATUS.SUSPENDED });

        expect((await verify(token)).status).toBe(401);
    });
});

describe('password login', () => {
    it('rejects a client (no password) with the generic 401', async () => {
        const { user } = await clientWithLink();

        const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'anything-at-all' });

        expect(res.status).toBe(401);
    });

    it('still works for staff', async () => {
        const { user } = await createUserWithToken(ROLE.SUPER_ADMIN);

        const res = await request(app).post('/api/auth/login').send({ email: user.email, password: STAFF_PASSWORD });

        expect(res.status).toBe(200);
    });

    it('rejects a suspended staff member', async () => {
        const { user } = await createUserWithToken(ROLE.ADMIN);
        await db.orm.public.User.where({ id: user.id }).update({ status: USER_STATUS.SUSPENDED });

        const res = await request(app).post('/api/auth/login').send({ email: user.email, password: STAFF_PASSWORD });

        expect(res.status).toBe(401);
    });
});
