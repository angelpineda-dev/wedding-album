import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { MEDIA_KIND, MEDIA_STATUS } from '../src/core/const/media.ts';
import { runCleanup } from '../src/services/cleanupService.ts';
import { headObject } from '../src/services/storageService.ts';
import { createSession } from '../src/services/sessionService.ts';
import { addMedia, createEnabledEvent, createUserWithToken, mockMail, resetDatabase } from './helpers.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(async () => {
    await resetDatabase();
    mockMail();
});
afterAll(() => db.close());

async function eventWithGuest() {
    const created = await createEnabledEvent();
    const joined = await request(app).post(`/api/public/events/${created.event.publicCode}/guests`).send({ name: 'Sofía' });
    return { ...created, guestId: joined.body.data.guest.id as string, guestToken: joined.body.data.token as string };
}

describe('storage usage', () => {
    it('counts confirmed files (not unfinished uploads) per event, per client and in total', async () => {
        const a = await eventWithGuest();
        const b = await eventWithGuest();
        await addMedia(a.event.id, a.guestId, { status: MEDIA_STATUS.PUBLISHED });
        await addMedia(a.event.id, a.guestId, { status: MEDIA_STATUS.HIDDEN });
        await addMedia(a.event.id, a.guestId, { status: MEDIA_STATUS.UPLOADING });
        await addMedia(b.event.id, b.guestId, { status: MEDIA_STATUS.PENDING });
        const admin = await createUserWithToken(ROLE.SUPER_ADMIN);

        const event = await request(app).get(`/api/events/${a.event.id}`).set('Authorization', a.owner.auth);
        expect(event.body.data.storageBytes).toBe(2000);

        const clients = await request(app).get('/api/admin/clients').set('Authorization', admin.auth);
        const byId = new Map(clients.body.data.map((c: { id: number }) => [c.id, c]));
        expect(byId.get(a.owner.user.id)).toMatchObject({ eventCount: 1, storageBytes: 2000 });
        expect(byId.get(b.owner.user.id)).toMatchObject({ eventCount: 1, storageBytes: 1000 });

        const stats = await request(app).get('/api/admin/stats').set('Authorization', admin.auth);
        expect(stats.body.data.storageBytes).toBe(3000);
    });
});

describe('runCleanup', () => {
    it('removes abandoned uploads (file and record) but keeps recent and confirmed ones', async () => {
        const { event, guestId, guestToken } = await eventWithGuest();

        // A real abandoned upload: URL issued, file PUT, never completed.
        const started = (await request(app).post('/api/guest/media').set('Authorization', `Bearer ${guestToken}`).send({
            kind: MEDIA_KIND.PHOTO, mimeType: 'image/jpeg', sizeBytes: 4, latitude: 0, longitude: 0,
        })).body.data;
        await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: new Uint8Array([1, 2, 3, 4]) });
        await db.orm.public.Media.where({ id: started.media.id }).update({ createdAt: new Date(Date.now() - 2 * HOUR) });
        const storageKey = (await db.orm.public.Media.where({ id: started.media.id }).first())!.storageKey;

        const recent = await addMedia(event.id, guestId, { status: MEDIA_STATUS.UPLOADING });
        const oldConfirmed = await addMedia(event.id, guestId, { status: MEDIA_STATUS.PENDING, at: new Date(Date.now() - 5 * DAY) });

        const result = await runCleanup();

        expect(result.staleUploads).toBe(1);
        expect(await db.orm.public.Media.where({ id: started.media.id }).first()).toBeNull();
        expect(await headObject(storageKey)).toBeNull();
        expect(await db.orm.public.Media.where({ id: recent.id }).first()).not.toBeNull();
        expect(await db.orm.public.Media.where({ id: oldConfirmed.id }).first()).not.toBeNull();
    });

    it('removes spent links and expired sessions, keeps live ones and revoked-but-unexpired sessions', async () => {
        const { user } = await createUserWithToken(ROLE.USER); // sends one fresh magic link
        await db.orm.public.MagicLink.create({
            userId: user.id, tokenHash: 'old-used', expiresAt: new Date(Date.now() - 3 * DAY), usedAt: new Date(Date.now() - 3 * DAY),
        });

        await createSession(user.id, {});
        await createSession(user.id, {});
        const sessions = await db.orm.public.Session.where({ userId: user.id }).all();
        await db.orm.public.Session.where({ id: sessions[0]!.id }).update({ expiresAt: new Date(Date.now() - 2 * DAY) });
        await db.orm.public.Session.where({ id: sessions[1]!.id }).update({ revokedAt: new Date() });

        const result = await runCleanup();

        expect(result).toMatchObject({ magicLinks: 1, sessions: 1 });
        expect(await db.orm.public.MagicLink.where({ userId: user.id }).all()).toHaveLength(1);
        const left = await db.orm.public.Session.where({ userId: user.id }).all();
        expect(left.map((s) => s.id)).toEqual([sessions[1]!.id]);
    });

    it('is a no-op when there is nothing to clean', async () => {
        expect(await runCleanup()).toEqual({ staleUploads: 0, magicLinks: 0, sessions: 0 });
    });
});
