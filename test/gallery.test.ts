import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { MEDIA_KIND, MEDIA_STATUS } from '../src/core/const/media.ts';
import { addMedia, createEnabledEvent, mockMail, resetDatabase } from './helpers.ts';

const MINUTE = 60_000;
const minutesAgo = (n: number) => new Date(Date.now() - n * MINUTE);

let code: string;
let eventId: string;
let ownerAuth: string;
let guestId: string;

beforeEach(async () => {
    await resetDatabase();
    mockMail();
    const { event, owner } = await createEnabledEvent();
    code = event.publicCode;
    eventId = event.id;
    ownerAuth = owner.auth;
    const joined = await request(app).post(`/api/public/events/${code}/guests`).send({ name: 'Sofía' });
    guestId = joined.body.data.guest.id;
});
afterAll(() => db.close());

const gallery = (query = '') => request(app).get(`/api/public/events/${code}/gallery${query}`);
const ids = (res: request.Response) => res.body.data.items.map((item: { id: string }) => item.id);

describe('GET /api/public/events/:code/gallery', () => {
    it('shows only published media, newest first, without a guest token', async () => {
        const old = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(10) });
        const recent = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(1) });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.HIDDEN });
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.UPLOADING });

        const res = await gallery();

        expect(res.status).toBe(200);
        expect(ids(res)).toEqual([recent.id, old.id]);
        expect(res.body.data.items[0]).toMatchObject({ guestName: 'Sofía', kind: MEDIA_KIND.PHOTO });
        expect(res.body.data.items[0].url).toMatch(/^http/);
        expect(res.body.data.pollSeconds).toBe(120);
        expect(res.body.data.nextCursor).toBeNull();
    });

    it('pages through older items with nextCursor', async () => {
        const created = [];
        for (let i = 5; i >= 1; i -= 1) {
            created.push(await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(i) }));
        }
        const newestFirst = created.reverse().map((m) => m.id);

        const seen: string[] = [];
        let cursor: string | null = null;
        do {
            const res = await gallery(`?limit=2${cursor ? `&before=${cursor}` : ''}`);
            seen.push(...ids(res));
            cursor = res.body.data.nextCursor;
        } while (cursor);

        expect(seen).toEqual(newestFirst);
    });

    it('polling with since returns only what is new, and the cursor stays put when nothing is', async () => {
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(5) });
        const first = await gallery();
        const latest = first.body.data.latestCursor;

        const idle = await gallery(`?since=${latest}`);
        expect(ids(idle)).toEqual([]);
        expect(idle.body.data.latestCursor).toBe(latest);

        const a = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(2) });
        const b = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, at: minutesAgo(1) });

        const poll = await gallery(`?since=${latest}`);
        expect(ids(poll)).toEqual([b.id, a.id]);
        expect(poll.body.data.latestCursor).not.toBe(latest);
    });

    it('an item approved by the client shows up on the next poll', async () => {
        const latest = (await gallery()).body.data.latestCursor;
        const pending = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PENDING, at: minutesAgo(30) });

        await request(app).post(`/api/events/${eventId}/media/${pending.id}/approve`).set('Authorization', ownerAuth);

        // First answer had no items, so poll from the start.
        const res = latest ? await gallery(`?since=${latest}`) : await gallery();
        expect(ids(res)).toEqual([pending.id]);
    });

    it('filters by kind', async () => {
        await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED });
        const video = await addMedia(eventId, guestId, { status: MEDIA_STATUS.PUBLISHED, kind: MEDIA_KIND.VIDEO });

        expect(ids(await gallery('?kind=VIDEO'))).toEqual([video.id]);
    });

    it.each([
        ['a malformed cursor', '?before=abc'],
        ['before and since together', '?before=x&since=y'],
        ['a limit over 100', '?limit=101'],
    ])('400 with %s', async (_label, query) => {
        expect((await gallery(query)).status).toBe(400);
    });

    it('404 for an unknown code', async () => {
        expect((await request(app).get('/api/public/events/ZZZZZZ/gallery')).status).toBe(404);
    });
});
