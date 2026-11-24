import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { EVENT_STATUS, RADIUS_METERS } from '../src/core/const/event.ts';
import { createUserWithToken, eventBody, mockMail, resetDatabase } from './helpers.ts';

let client: Awaited<ReturnType<typeof createUserWithToken>>;

const post = (auth: string, body: object) => request(app).post('/api/events').set('Authorization', auth).send(body);
const patch = (auth: string, id: string, body: object) =>
    request(app).patch(`/api/events/${id}`).set('Authorization', auth).send(body);

beforeEach(async () => {
    await resetDatabase();
    mockMail();
    client = await createUserWithToken(ROLE.USER);
});
afterAll(() => db.close());

describe('POST /api/events', () => {
    it('creates a PENDING event with defaults and a public code', async () => {
        const res = await post(client.auth, eventBody());

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            name: 'Ana & Luis',
            status: EVENT_STATUS.PENDING,
            ownerId: client.user.id,
            moderationRequired: true,
            galleryPollSeconds: 120,
            geofenceEnabled: false,
            radiusMeters: RADIUS_METERS.DEFAULT,
            packageMax: null,
            guestLimit: null,
        });
        expect(res.body.data.publicCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
        expect(new Date(res.body.data.opensAt).toISOString()).toBe('2027-03-14T22:00:00.000Z');
    });

    it('accepts a custom poll interval and a geofence with coordinates', async () => {
        const res = await post(client.auth, eventBody({
            galleryPollSeconds: 30,
            geofenceEnabled: true,
            latitude: 20.6597,
            longitude: -103.3496,
            radiusMeters: RADIUS_METERS.MAX,
        }));

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ galleryPollSeconds: 30, geofenceEnabled: true, latitude: 20.6597 });
    });

    it('409 once the quota is used up', async () => {
        expect((await post(client.auth, eventBody())).status).toBe(201);

        const res = await post(client.auth, eventBody({ name: 'Otra' }));
        expect(res.status).toBe(409);
    });

    it('does not exceed the quota under concurrent requests', async () => {
        const results = await Promise.all(Array.from({ length: 5 }, () => post(client.auth, eventBody())));

        expect(results.filter((res) => res.status === 201)).toHaveLength(1);
        expect(results.filter((res) => res.status === 409)).toHaveLength(4);
    });

    it.each([
        ['closesAt before opensAt', { closesAt: '2027-03-14T15:00:00-06:00' }],
        ['a window over 72 h', { closesAt: '2027-03-18T16:00:00-06:00' }],
        ['a geofence without coordinates', { geofenceEnabled: true }],
        ['an unknown time zone', { timezone: 'Mars/Olympus_Mons' }],
        ['a timestamp without offset', { opensAt: '2027-03-14T16:00:00' }],
        ['a poll interval under 15 s', { galleryPollSeconds: 5 }],
        ['a geofence radius over 1 km', { radiusMeters: RADIUS_METERS.MAX + 1 }],
        ['a geofence radius under 100 m', { radiusMeters: RADIUS_METERS.MIN - 1 }],
        ['a server-managed field', { status: EVENT_STATUS.ENABLED }],
        ['a package', { packageMax: 100 }],
    ])('400 with %s', async (_label, overrides) => {
        const res = await post(client.auth, eventBody(overrides));
        expect(res.status).toBe(400);
    });

    it.each([ROLE.SUPER_ADMIN, ROLE.ADMIN])('403 for %s', async (role) => {
        const { auth } = await createUserWithToken(role);
        expect((await post(auth, eventBody())).status).toBe(403);
    });
});

describe('reading and updating own events', () => {
    it('lists and reads only the client’s own events', async () => {
        const mine = (await post(client.auth, eventBody())).body.data;
        const other = await createUserWithToken(ROLE.USER);
        const theirs = (await post(other.auth, eventBody({ name: 'Otros' }))).body.data;

        const list = await request(app).get('/api/events').set('Authorization', client.auth);
        expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([mine.id]);

        expect((await request(app).get(`/api/events/${mine.id}`).set('Authorization', client.auth)).status).toBe(200);
        expect((await request(app).get(`/api/events/${theirs.id}`).set('Authorization', client.auth)).status).toBe(404);
        expect((await patch(client.auth, theirs.id, { name: 'Robado' })).status).toBe(404);
    });

    it('updates settings, validating against the stored values', async () => {
        const event = (await post(client.auth, eventBody())).body.data;

        const ok = await patch(client.auth, event.id, { moderationRequired: false, galleryPollSeconds: 60 });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({ moderationRequired: false, galleryPollSeconds: 60, name: 'Ana & Luis' });

        // Only closesAt is sent; it is checked against the stored opensAt.
        expect((await patch(client.auth, event.id, { closesAt: '2027-03-14T10:00:00-06:00' })).status).toBe(400);
        // Turning the geofence on needs coordinates, sent now or already stored.
        expect((await patch(client.auth, event.id, { geofenceEnabled: true })).status).toBe(400);
    });

    it('409 when the event is suspended', async () => {
        const event = (await post(client.auth, eventBody())).body.data;
        await db.orm.public.Event.where({ id: event.id }).update({ status: EVENT_STATUS.SUSPENDED });

        expect((await patch(client.auth, event.id, { name: 'Nuevo' })).status).toBe(409);
    });

    it('400 for an empty update or a malformed id', async () => {
        const event = (await post(client.auth, eventBody())).body.data;
        expect((await patch(client.auth, event.id, {})).status).toBe(400);
        expect((await request(app).get('/api/events/not-a-uuid').set('Authorization', client.auth)).status).toBe(400);
    });
});
