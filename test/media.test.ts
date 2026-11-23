import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { MAX_OPEN_UPLOADS, MEDIA_KIND, MEDIA_STATUS } from '../src/core/const/media.ts';
import { createEnabledEvent, mockMail, resetDatabase } from './helpers.ts';

const AT_VENUE = { latitude: 20.6597, longitude: -103.3496 };
const FAR_AWAY = { latitude: 20.2963, longitude: -103.1906 };
const PHOTO = Buffer.from('not really a jpeg, but bytes are bytes');

const asGuest = (token: string) => ({ Authorization: `Bearer ${token}` });

async function joinedGuest(options: Parameters<typeof createEnabledEvent>[0] = {}) {
    const { event, owner } = await createEnabledEvent(options);
    const res = await request(app).post(`/api/public/events/${event.publicCode}/guests`).send({ name: 'Sofía' });
    return { event, owner, token: res.body.data.token as string };
}

const startUpload = (token: string, overrides: Record<string, unknown> = {}) =>
    request(app).post('/api/guest/media').set(asGuest(token)).send({
        kind: MEDIA_KIND.PHOTO,
        mimeType: 'image/jpeg',
        sizeBytes: PHOTO.length,
        ...AT_VENUE,
        ...overrides,
    });

const complete = (token: string, id: string) =>
    request(app).post(`/api/guest/media/${id}/complete`).set(asGuest(token));

/** PUTs `body` to a presigned upload as a phone would. */
const put = (upload: { url: string; headers: Record<string, string> }, body: Buffer) =>
    fetch(upload.url, { method: 'PUT', headers: upload.headers, body: new Uint8Array(body) });

beforeEach(async () => {
    await resetDatabase();
    mockMail();
});
afterAll(() => db.close());

describe('upload flow', () => {
    it('presign → PUT to storage → complete → PENDING (moderation on), visible in "mine"', async () => {
        const { token } = await joinedGuest({ geofence: true });

        const started = await startUpload(token);
        expect(started.status).toBe(201);
        expect(started.body.data.media.status).toBe(MEDIA_STATUS.UPLOADING);
        expect(started.body.data.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/jpeg' } });

        expect((await put(started.body.data.upload, PHOTO)).status).toBe(200);

        const done = await complete(token, started.body.data.media.id);
        expect(done.status).toBe(200);
        expect(done.body.data.status).toBe(MEDIA_STATUS.PENDING);

        const mine = await request(app).get('/api/guest/media/mine').set(asGuest(token));
        expect(mine.body.data).toHaveLength(1);
        expect(mine.body.data[0]).toMatchObject({ status: MEDIA_STATUS.PENDING, kind: MEDIA_KIND.PHOTO });

        const download = await fetch(mine.body.data[0].url);
        expect(download.status).toBe(200);
        expect(Buffer.from(await download.arrayBuffer())).toEqual(PHOTO);
    });

    it('goes straight to PUBLISHED when the event does not moderate', async () => {
        const { event, token } = await joinedGuest();
        await db.orm.public.Event.where({ id: event.id }).update({ moderationRequired: false });
        const started = (await startUpload(token)).body.data;
        await put(started.upload, PHOTO);

        const done = await complete(token, started.media.id);

        expect(done.body.data.status).toBe(MEDIA_STATUS.PUBLISHED);
        const stored = await db.orm.public.Media.where({ id: started.media.id }).first();
        expect(stored?.publishedAt).not.toBeNull();
    });

    it('completing twice returns the same result', async () => {
        const { token } = await joinedGuest();
        const started = (await startUpload(token)).body.data;
        await put(started.upload, PHOTO);

        await complete(token, started.media.id);
        const again = await complete(token, started.media.id);

        expect(again.status).toBe(200);
        expect(again.body.data.status).toBe(MEDIA_STATUS.PENDING);
    });

    it('409 when completing before the file was uploaded; not listed in "mine"', async () => {
        const { token } = await joinedGuest();
        const started = (await startUpload(token)).body.data;

        expect((await complete(token, started.media.id)).status).toBe(409);
        expect((await request(app).get('/api/guest/media/mine').set(asGuest(token))).body.data).toEqual([]);
    });

    it('storage rejects a PUT whose size differs from the signed one', async () => {
        const { token } = await joinedGuest();
        const started = (await startUpload(token)).body.data;

        const res = await put(started.upload, Buffer.concat([PHOTO, Buffer.from('extra')]));

        expect(res.ok).toBe(false);
    });

    it('422 and cleanup when the stored file does not match the record', async () => {
        const { token } = await joinedGuest();
        const started = (await startUpload(token)).body.data;
        await put(started.upload, PHOTO);
        await db.orm.public.Media.where({ id: started.media.id }).update({ sizeBytes: PHOTO.length + 1 });

        expect((await complete(token, started.media.id)).status).toBe(422);
        expect(await db.orm.public.Media.where({ id: started.media.id }).first()).toBeNull();
    });

    it('404 for another guest’s upload', async () => {
        const { event, token } = await joinedGuest();
        const other = (await request(app).post(`/api/public/events/${event.publicCode}/guests`).send({ name: 'Otro' })).body.data.token;
        const started = (await startUpload(token)).body.data;

        expect((await complete(other, started.media.id)).status).toBe(404);
    });
});

describe('upload rules', () => {
    it('403 outside the geofence or before the window opens', async () => {
        const geo = await joinedGuest({ geofence: true });
        expect((await startUpload(geo.token, FAR_AWAY)).status).toBe(403);

        const early = await joinedGuest({ open: false });
        expect((await startUpload(early.token)).status).toBe(403);
    });

    it.each([
        ['an unsupported type', { mimeType: 'application/pdf' }, 415],
        ['a video type declared as a photo', { mimeType: 'video/mp4' }, 415],
        ['a photo over 25 MB', { sizeBytes: 25 * 1024 * 1024 + 1 }, 413],
        ['an unknown kind', { kind: 'AUDIO' }, 400],
        ['missing coordinates', { latitude: undefined }, 400],
    ])('rejects %s', async (_label, overrides, status) => {
        const { token } = await joinedGuest();
        expect((await startUpload(token, overrides)).status).toBe(status);
    });

    it('accepts a large video within its own limit', async () => {
        const { token } = await joinedGuest();
        const res = await startUpload(token, { kind: MEDIA_KIND.VIDEO, mimeType: 'video/quicktime', sizeBytes: 150 * 1024 * 1024 });
        expect(res.status).toBe(201);
    });

    it(`429 after ${MAX_OPEN_UPLOADS} unfinished uploads`, async () => {
        const { token } = await joinedGuest();
        for (let i = 0; i < MAX_OPEN_UPLOADS; i += 1) {
            expect((await startUpload(token)).status).toBe(201);
        }
        expect((await startUpload(token)).status).toBe(429);
    });

    it('401 without a guest token', async () => {
        const res = await request(app).post('/api/guest/media').send({});
        expect(res.status).toBe(401);
    });
});
