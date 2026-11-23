import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { EVENT_STATUS } from '../src/core/const/event.ts';
import { createUserWithToken, eventBody, mockMail, resetDatabase } from './helpers.ts';

let admin: string;
let client: Awaited<ReturnType<typeof createUserWithToken>>;

beforeEach(async () => {
    await resetDatabase();
    mockMail();
    admin = (await createUserWithToken(ROLE.SUPER_ADMIN)).auth;
    client = await createUserWithToken(ROLE.USER);
});
afterAll(() => db.close());

const createEvent = async () =>
    (await request(app).post('/api/events').set('Authorization', client.auth).send(eventBody())).body.data;

const enable = (id: string, body: object) =>
    request(app).post(`/api/admin/events/${id}/enable`).set('Authorization', admin).send(body);

describe('GET /api/admin/events', () => {
    it('lists events with their owner, filterable by status', async () => {
        const event = await createEvent();

        const pending = await request(app).get('/api/admin/events?status=PENDING').set('Authorization', admin);
        expect(pending.status).toBe(200);
        expect(pending.body.data).toHaveLength(1);
        expect(pending.body.data[0]).toMatchObject({
            id: event.id,
            owner: { id: client.user.id, email: client.user.email },
        });
        expect(pending.body.data[0].owner).not.toHaveProperty('password');

        const enabled = await request(app).get('/api/admin/events?status=ENABLED').set('Authorization', admin);
        expect(enabled.body.data).toEqual([]);
    });

    it('403 for ADMIN', async () => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        expect((await request(app).get('/api/admin/events').set('Authorization', auth)).status).toBe(403);
    });
});

describe('enabling and suspending', () => {
    it('enables with a package and exposes the guest limit (package + 5)', async () => {
        const event = await createEvent();

        const res = await enable(event.id, { packageMax: 100 });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: EVENT_STATUS.ENABLED, packageMax: 100, guestLimit: 105 });
        expect(res.body.data.enabledAt).toBeTruthy();

        const seen = await request(app).get(`/api/events/${event.id}`).set('Authorization', client.auth);
        expect(seen.body.data.guestLimit).toBe(105);
    });

    it('enabling again changes the package but keeps the first enabledAt', async () => {
        const event = await createEvent();
        const first = (await enable(event.id, { packageMax: 100 })).body.data;

        const second = (await enable(event.id, { packageMax: 125 })).body.data;

        expect(second.packageMax).toBe(125);
        expect(second.enabledAt).toBe(first.enabledAt);
    });

    it.each([[90], [0], [1025], ['100']])('400 for package %s', async (packageMax) => {
        const event = await createEvent();
        expect((await enable(event.id, { packageMax })).status).toBe(400);
    });

    it('suspends an event', async () => {
        const event = await createEvent();

        const res = await request(app).post(`/api/admin/events/${event.id}/suspend`).set('Authorization', admin);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(EVENT_STATUS.SUSPENDED);
    });

    it('404 for an unknown event', async () => {
        expect((await enable('00000000-0000-4000-8000-000000000000', { packageMax: 100 })).status).toBe(404);
    });
});

describe('GET /api/admin/stats', () => {
    it('counts active clients, pending and enabled events', async () => {
        const event = await createEvent();
        const other = await createUserWithToken(ROLE.USER);
        await request(app).post('/api/events').set('Authorization', other.auth).send(eventBody());
        await enable(event.id, { packageMax: 50 });

        const res = await request(app).get('/api/admin/stats').set('Authorization', admin);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ activeClients: 2, pendingEvents: 1, enabledEvents: 1 });
    });
});
