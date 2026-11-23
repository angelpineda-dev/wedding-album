import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { EVENT_STATUS, UPLOAD_WINDOW } from '../src/core/const/event.ts';
import { hashToken } from '../src/services/tokenService.ts';
import { createEnabledEvent, eventBody, mockMail, resetDatabase } from './helpers.ts';

const GUADALAJARA = { latitude: 20.6597, longitude: -103.3496 };
const NEARBY = { latitude: 20.6700, longitude: -103.3600 }; // ~1.6 km away
const CHAPALA = { latitude: 20.2963, longitude: -103.1906 }; // ~43 km away

const join = (code: string, name = 'Sofía') =>
    request(app).post(`/api/public/events/${code}/guests`).send({ name });
const asGuest = (token: string) => ({ Authorization: `Bearer ${token}` });
const presence = (token: string, position: object) =>
    request(app).post('/api/guest/presence').set(asGuest(token)).send(position);

/** Fills an event with `count` guests straight in the database. */
async function addGuests(eventId: string, count: number) {
    for (let i = 0; i < count; i += 1) {
        await db.orm.public.Guest.create({
            eventId,
            name: `Invitado ${i}`,
            tokenHash: hashToken(`seed-${eventId}-${i}`),
            expiresAt: new Date(Date.now() + 86_400_000),
            lastSeenAt: null,
        });
    }
}

beforeEach(async () => {
    await resetDatabase();
    mockMail();
});
afterAll(() => db.close());

describe('GET /api/public/events/:code', () => {
    it('shows what the QR needs, without the venue coordinates', async () => {
        const { event } = await createEnabledEvent({ geofence: true });

        const res = await request(app).get(`/api/public/events/${event.publicCode.toLowerCase()}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            code: event.publicCode,
            name: 'Ana & Luis',
            uploadWindow: UPLOAD_WINDOW.OPEN,
            geofenceEnabled: true,
            radiusMeters: 5000,
            galleryPollSeconds: 120,
        });
        expect(res.body.data).not.toHaveProperty('latitude');
        expect(res.body.data).not.toHaveProperty('id');
        expect(res.body.data).not.toHaveProperty('ownerId');
    });

    it('404 for pending, suspended or unknown codes', async () => {
        const { owner, event } = await createEnabledEvent();
        await db.orm.public.Event.where({ id: event.id }).update({ status: EVENT_STATUS.SUSPENDED });
        await db.orm.public.User.where({ id: owner.user.id }).update({ eventQuota: 2 });
        const pending = (await request(app).post('/api/events').set('Authorization', owner.auth).send(eventBody())).body.data;

        expect((await request(app).get(`/api/public/events/${event.publicCode}`)).status).toBe(404);
        expect((await request(app).get(`/api/public/events/${pending.publicCode}`)).status).toBe(404);
        expect((await request(app).get('/api/public/events/ZZZZZZ')).status).toBe(404);
    });
});

describe('POST /api/public/events/:code/guests', () => {
    it('joins with a name and gets a token that works on /guest', async () => {
        const { event } = await createEnabledEvent();

        const res = await join(event.publicCode, '  Sofía Ramírez ');

        expect(res.status).toBe(201);
        expect(res.body.data.guest.name).toBe('Sofía Ramírez');
        expect(res.body.data.token).toBeTruthy();
        expect(res.body.data.event.code).toBe(event.publicCode);

        const me = await request(app).get('/api/guest/me').set(asGuest(res.body.data.token));
        expect(me.status).toBe(200);
        expect(me.body.data.guest.name).toBe('Sofía Ramírez');

        const stored = await db.orm.public.Guest.where({ id: res.body.data.guest.id }).first();
        expect(stored?.tokenHash).not.toBe(res.body.data.token);
    });

    it('allows joining before the window opens', async () => {
        const { event } = await createEnabledEvent({ open: false });
        expect((await join(event.publicCode)).status).toBe(201);
    });

    it('409 after the event closed', async () => {
        const { event } = await createEnabledEvent();
        await db.orm.public.Event.where({ id: event.id }).update({
            opensAt: new Date(Date.now() - 10_000_000),
            closesAt: new Date(Date.now() - 1000),
        });

        expect((await join(event.publicCode)).status).toBe(409);
    });

    it('lets in package + 5 guests and no more', async () => {
        const { event } = await createEnabledEvent({ packageMax: 25 });
        await addGuests(event.id, 29);

        expect((await join(event.publicCode)).status).toBe(201);
        expect((await join(event.publicCode)).status).toBe(409);
    });

    it('does not go over the limit under concurrent joins', async () => {
        const { event } = await createEnabledEvent({ packageMax: 25 });
        await addGuests(event.id, 28);

        const results = await Promise.all(Array.from({ length: 6 }, (_, i) => join(event.publicCode, `G${i}`)));

        expect(results.filter((res) => res.status === 201)).toHaveLength(2);
        expect(results.filter((res) => res.status === 409)).toHaveLength(4);
    });

    it.each([['an empty name', { name: '   ' }], ['an extra field', { name: 'Ana', admin: true }]])(
        '400 with %s',
        async (_label, body) => {
            const { event } = await createEnabledEvent();
            const res = await request(app).post(`/api/public/events/${event.publicCode}/guests`).send(body);
            expect(res.status).toBe(400);
        },
    );
});

describe('guest token', () => {
    it('401 once the event is suspended, the token expires, or for a user token', async () => {
        const { owner, event } = await createEnabledEvent();
        const { token, guest } = (await join(event.publicCode)).body.data;

        expect((await request(app).get('/api/guest/me').set({ Authorization: owner.auth })).status).toBe(401);
        expect((await request(app).get('/api/guest/me').set(asGuest('nope'))).status).toBe(401);

        await db.orm.public.Guest.where({ id: guest.id }).update({ expiresAt: new Date(Date.now() - 1000) });
        expect((await request(app).get('/api/guest/me').set(asGuest(token))).status).toBe(401);

        await db.orm.public.Guest.where({ id: guest.id }).update({ expiresAt: new Date(Date.now() + 86_400_000) });
        await db.orm.public.Event.where({ id: event.id }).update({ status: EVENT_STATUS.SUSPENDED });
        expect((await request(app).get('/api/guest/me').set(asGuest(token))).status).toBe(401);
    });
});

describe('POST /api/guest/presence', () => {
    it('without geofence: inside, and can upload while the window is open', async () => {
        const { event } = await createEnabledEvent();
        const { token } = (await join(event.publicCode)).body.data;

        const res = await presence(token, CHAPALA);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ canUpload: true, inside: true, distanceMeters: null, uploadWindow: UPLOAD_WINDOW.OPEN });
    });

    it('with geofence: inside near the venue, outside far away', async () => {
        const { event } = await createEnabledEvent({ geofence: true });
        const { token, guest } = (await join(event.publicCode)).body.data;

        const near = await presence(token, NEARBY);
        expect(near.body.data).toMatchObject({ canUpload: true, inside: true, radiusMeters: 5000 });
        expect(near.body.data.distanceMeters).toBeGreaterThan(1000);
        expect(near.body.data.distanceMeters).toBeLessThan(2500);

        const far = await presence(token, CHAPALA);
        expect(far.body.data).toMatchObject({ canUpload: false, inside: false });
        expect(far.body.data.distanceMeters).toBeGreaterThan(30_000);

        const at = await presence(token, GUADALAJARA);
        expect(at.body.data.distanceMeters).toBe(0);

        const stored = await db.orm.public.Guest.where({ id: guest.id }).first();
        expect(stored?.lastSeenAt).not.toBeNull();
    });

    it('cannot upload before the window opens, even at the venue', async () => {
        const { event } = await createEnabledEvent({ open: false, geofence: true });
        const { token } = (await join(event.publicCode)).body.data;

        const res = await presence(token, GUADALAJARA);

        expect(res.body.data).toMatchObject({ canUpload: false, inside: true, uploadWindow: UPLOAD_WINDOW.UPCOMING });
    });

    it('400 for coordinates out of range', async () => {
        const { event } = await createEnabledEvent();
        const { token } = (await join(event.publicCode)).body.data;
        expect((await presence(token, { latitude: 91, longitude: 0 })).status).toBe(400);
    });
});

describe('client view', () => {
    it('GET /api/events counts joined guests', async () => {
        const { owner, event } = await createEnabledEvent();
        await join(event.publicCode, 'A');
        await join(event.publicCode, 'B');

        const res = await request(app).get('/api/events').set('Authorization', owner.auth);
        expect(res.body.data[0].guestCount).toBe(2);

        const one = await request(app).get(`/api/events/${event.id}`).set('Authorization', owner.auth);
        expect(one.body.data.guestCount).toBe(2);
    });
});
