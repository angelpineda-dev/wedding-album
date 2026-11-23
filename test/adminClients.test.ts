import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { USER_STATUS } from '../src/core/const/userStatus.ts';
import { createUserWithToken, mockMail, resetDatabase, sentMagicLinks } from './helpers.ts';

let mail: ReturnType<typeof mockMail>;
let admin: string;

beforeEach(async () => {
    await resetDatabase();
    mail = mockMail();
    admin = (await createUserWithToken(ROLE.SUPER_ADMIN)).auth;
});
afterAll(() => db.close());

const patch = (id: number, body: object) =>
    request(app).patch(`/api/admin/clients/${id}`).set('Authorization', admin).send(body);

describe('admin access', () => {
    it.each([ROLE.ADMIN, ROLE.USER])('403 for %s', async (role) => {
        const { auth } = await createUserWithToken(role);
        const res = await request(app).get('/api/admin/clients').set('Authorization', auth);
        expect(res.status).toBe(403);
    });

    it('401 without a token', async () => {
        expect((await request(app).get('/api/admin/clients')).status).toBe(401);
    });
});

describe('GET /api/admin/clients', () => {
    it('lists only clients, newest first, filterable by status', async () => {
        await createUserWithToken(ROLE.ADMIN);
        const first = (await createUserWithToken(ROLE.USER)).user;
        const second = (await createUserWithToken(ROLE.USER)).user;
        await db.orm.public.User.where({ id: first.id }).update({ status: USER_STATUS.SUSPENDED });

        const all = await request(app).get('/api/admin/clients').set('Authorization', admin);
        expect(all.status).toBe(200);
        expect(all.body.data.map((c: { id: number }) => c.id)).toEqual([second.id, first.id]);
        expect(all.body.data[0]).not.toHaveProperty('password');

        const suspended = await request(app).get('/api/admin/clients?status=SUSPENDED').set('Authorization', admin);
        expect(suspended.body.data.map((c: { id: number }) => c.id)).toEqual([first.id]);
    });

    it('400 for an unknown status', async () => {
        const res = await request(app).get('/api/admin/clients?status=GONE').set('Authorization', admin);
        expect(res.status).toBe(400);
    });
});

describe('PATCH /api/admin/clients/:id', () => {
    it('changes the event quota', async () => {
        const { user } = await createUserWithToken(ROLE.USER);

        const res = await patch(user.id, { eventQuota: 4 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: user.id, eventQuota: 4 });
    });

    it('suspending cuts the client off immediately', async () => {
        const { user, auth } = await createUserWithToken(ROLE.USER);
        expect((await request(app).get('/api/user/me').set('Authorization', auth)).status).toBe(200);

        const res = await patch(user.id, { status: USER_STATUS.SUSPENDED });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(USER_STATUS.SUSPENDED);
        expect((await request(app).get('/api/user/me').set('Authorization', auth)).status).toBe(401);
    });

    it('404 for staff or unknown ids', async () => {
        const { user: staff } = await createUserWithToken(ROLE.ADMIN);
        expect((await patch(staff.id, { eventQuota: 2 })).status).toBe(404);
        expect((await patch(9999, { eventQuota: 2 })).status).toBe(404);
    });

    it.each([
        ['an empty body', {}],
        ['an unknown field', { role: ROLE.SUPER_ADMIN }],
        ['a quota out of range', { eventQuota: 51 }],
    ])('400 with %s', async (_label, body) => {
        const { user } = await createUserWithToken(ROLE.USER);
        expect((await patch(user.id, body)).status).toBe(400);
    });
});

describe('POST /api/admin/clients/:id/resend', () => {
    it('emails a new magic link', async () => {
        const { user } = await createUserWithToken(ROLE.USER);
        mail.mockClear();

        const res = await request(app).post(`/api/admin/clients/${user.id}/resend`).set('Authorization', admin);

        expect(res.status).toBe(202);
        expect(sentMagicLinks(mail).map((link) => link.to)).toEqual([user.email]);
    });

    it('409 for a suspended client', async () => {
        const { user } = await createUserWithToken(ROLE.USER);
        await patch(user.id, { status: USER_STATUS.SUSPENDED });

        const res = await request(app).post(`/api/admin/clients/${user.id}/resend`).set('Authorization', admin);

        expect(res.status).toBe(409);
    });
});
