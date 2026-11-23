import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { EVENT_STATUS } from '../src/core/const/event.ts';
import { MEDIA_STATUS } from '../src/core/const/media.ts';
import { addMedia, createEnabledEvent, createUserWithToken, mockMail, resetDatabase } from './helpers.ts';

let eventId: string;
let ownerAuth: string;
let ownerId: number;
let guestId: string;

beforeEach(async () => {
    await resetDatabase();
    mockMail();
    const { event, owner } = await createEnabledEvent();
    eventId = event.id;
    ownerAuth = owner.auth;
    ownerId = owner.user.id;
    guestId = (await request(app).post(`/api/public/events/${event.publicCode}/guests`).send({ name: 'Tío Jorge' })).body.data.guest.id;
});
afterAll(() => db.close());

const base = () => `/api/events/${eventId}/media`;
const ids = (res: request.Response) => res.body.data.items.map((item: { id: string }) => item.id);

describe('client moderating their event', () => {
    it('lists pending media by default, newest upload first', async () => {
        const older = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING, at: new Date(Date.now() - 60_000) });
        const newer = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED });

        const res = await request(app).get(base()).set('Authorization', ownerAuth);

        expect(res.status).toBe(200);
        expect(ids(res)).toEqual([newer.id, older.id]);
        expect(res.body.data.items[0]).toMatchObject({ guestName: 'Tío Jorge', status: MEDIA_STATUS.PENDING });
    });

    it('approves (records who) and hides', async () => {
        const media = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });

        const approved = await request(app).post(`${base()}/${media.id}/approve`).set('Authorization', ownerAuth);
        expect(approved.body.data.status).toBe(MEDIA_STATUS.PUBLISHED);
        const stored = await db.orm.public.Media.where({ id: media.id }).first();
        expect(stored).toMatchObject({ moderatedById: ownerId });
        expect(stored?.publishedAt).not.toBeNull();

        const hidden = await request(app).post(`${base()}/${media.id}/hide`).set('Authorization', ownerAuth);
        expect(hidden.body.data.status).toBe(MEDIA_STATUS.HIDDEN);

        const list = await request(app).get(`${base()}?status=HIDDEN`).set('Authorization', ownerAuth);
        expect(ids(list)).toEqual([media.id]);
    });

    it('approves every pending item at once', async () => {
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.HIDDEN });

        const res = await request(app).post(`${base()}/approve-all`).set('Authorization', ownerAuth);

        expect(res.body.data).toEqual({ approved: 2 });
        const pending = await request(app).get(base()).set('Authorization', ownerAuth);
        expect(ids(pending)).toEqual([]);
    });

    it('409 for an item still uploading; 404 for an item of another event', async () => {
        const uploading = await addMedia(eventId, guestId, { status: MEDIA_STATUS.UPLOADING });
        expect((await request(app).post(`${base()}/${uploading.id}/approve`).set('Authorization', ownerAuth)).status).toBe(409);

        const other = await createEnabledEvent();
        const otherGuest = (await request(app).post(`/api/public/events/${other.event.publicCode}/guests`).send({ name: 'X' })).body.data.guest.id;
        const foreign = await addMedia(other.event.id, otherGuest, { status: MEDIA_STATUS.PENDING });
        expect((await request(app).post(`${base()}/${foreign.id}/approve`).set('Authorization', ownerAuth)).status).toBe(404);
    });

    it('GET /api/events shows published and pending counts', async () => {
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED });

        const res = await request(app).get('/api/events').set('Authorization', ownerAuth);

        expect(res.body.data[0]).toMatchObject({ guestCount: 1, publishedCount: 2, pendingCount: 1 });
    });
});

describe('who may moderate', () => {
    it('another client gets 404', async () => {
        const media = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        const { auth } = await createUserWithToken(ROLE.USER);

        expect((await request(app).get(base()).set('Authorization', auth)).status).toBe(404);
        expect((await request(app).post(`${base()}/${media.id}/approve`).set('Authorization', auth)).status).toBe(404);
    });

    it('SUPER_ADMIN can moderate any event', async () => {
        const media = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        const admin = await createUserWithToken(ROLE.SUPER_ADMIN);

        const res = await request(app).post(`${base()}/${media.id}/hide`).set('Authorization', admin.auth);

        expect(res.status).toBe(200);
        expect((await db.orm.public.Media.where({ id: media.id }).first())?.moderatedById).toBe(admin.user.id);
    });

    it('ADMIN is not allowed yet (403)', async () => {
        const { auth } = await createUserWithToken(ROLE.ADMIN);
        expect((await request(app).get(base()).set('Authorization', auth)).status).toBe(403);
    });

    it('guests cannot moderate (401 with a guest token)', async () => {
        const res = await request(app).get(base()).set('Authorization', 'Bearer some-guest-token');
        expect(res.status).toBe(401);
    });
});

describe('GET /api/admin/moderation', () => {
    it('queues pending media of enabled events, oldest first, filterable by event', async () => {
        const admin = await createUserWithToken(ROLE.SUPER_ADMIN);
        const first = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING, at: new Date(Date.now() - 120_000) });

        const other = await createEnabledEvent();
        const otherGuest = (await request(app).post(`/api/public/events/${other.event.publicCode}/guests`).send({ name: 'Lucía' })).body.data.guest.id;
        const second = await addMedia(other.event.id, otherGuest, { status: MEDIA_STATUS.PENDING, at: new Date(Date.now() - 60_000) });

        const suspended = await createEnabledEvent();
        const suspendedGuest = (await request(app).post(`/api/public/events/${suspended.event.publicCode}/guests`).send({ name: 'Z' })).body.data.guest.id;
        await addMedia(suspended.event.id, suspendedGuest, { status: MEDIA_STATUS.PENDING });
        await db.orm.public.Event.where({ id: suspended.event.id }).update({ status: EVENT_STATUS.SUSPENDED });

        const all = await request(app).get('/api/admin/moderation').set('Authorization', admin.auth);
        expect(all.status).toBe(200);
        expect(ids(all)).toEqual([first.id, second.id]);
        expect(all.body.data.items[0]).toMatchObject({ eventName: 'Ana & Luis', guestName: 'Tío Jorge' });

        const one = await request(app).get(`/api/admin/moderation?eventId=${other.event.id}`).set('Authorization', admin.auth);
        expect(ids(one)).toEqual([second.id]);
    });

    it('403 for a client', async () => {
        expect((await request(app).get('/api/admin/moderation').set('Authorization', ownerAuth)).status).toBe(403);
    });
});
