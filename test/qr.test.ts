import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.ts';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { EVENT_STATUS } from '../src/core/const/event.ts';
import { renderQrPng } from '../src/services/qrService.ts';
import { createEnabledEvent, createUserWithToken, eventBody, mockMail, resetDatabase } from './helpers.ts';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** supertest buffers binary bodies only with an explicit parser. */
const binary = (req: request.Test) =>
    req.buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
    });

let event: Awaited<ReturnType<typeof createEnabledEvent>>['event'];
let ownerAuth: string;

beforeEach(async () => {
    await resetDatabase();
    mockMail();
    const created = await createEnabledEvent();
    event = created.event;
    ownerAuth = created.owner.auth;
});
afterAll(() => db.close());

describe('QR downloads', () => {
    it('PNG encodes the public gallery URL and downloads as a file', async () => {
        const res = await binary(request(app).get(`/api/events/${event.id}/qr.png`).set('Authorization', ownerAuth));

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['content-disposition']).toBe(`attachment; filename="qr-${event.publicCode}.png"`);
        expect((res.body as Buffer).subarray(0, 8)).toEqual(PNG_SIGNATURE);
        // Rendering is deterministic: same URL, same image.
        expect(res.body).toEqual(await renderQrPng(event.publicCode));
    });

    it('PDF is a printable document', async () => {
        const res = await binary(request(app).get(`/api/events/${event.id}/qr.pdf`).set('Authorization', ownerAuth));

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toBe(`attachment; filename="qr-${event.publicCode}.pdf"`);
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('409 while the event is not enabled', async () => {
        await db.orm.public.Event.where({ id: event.id }).update({ status: EVENT_STATUS.PENDING });

        expect((await request(app).get(`/api/events/${event.id}/qr.png`).set('Authorization', ownerAuth)).status).toBe(409);
        expect((await request(app).get(`/api/events/${event.id}/qr.pdf`).set('Authorization', ownerAuth)).status).toBe(409);
    });

    it('404 for another client’s event', async () => {
        const other = await createUserWithToken(ROLE.USER);
        expect((await request(app).get(`/api/events/${event.id}/qr.png`).set('Authorization', other.auth)).status).toBe(404);
    });

    it('events carry the shareable link ("Copiar enlace")', async () => {
        const res = await request(app).get(`/api/events/${event.id}`).set('Authorization', ownerAuth);
        expect(res.body.data.publicUrl).toBe(`http://localhost:5173/e/${event.publicCode}`);
    });
});

describe('POST /api/events/:id/qr/rotate', () => {
    it('issues a new code; the old one stops working, joined guests keep access', async () => {
        const joined = await request(app).post(`/api/public/events/${event.publicCode}/guests`).send({ name: 'Sofía' });
        const guestToken = joined.body.data.token;

        const res = await request(app).post(`/api/events/${event.id}/qr/rotate`).set('Authorization', ownerAuth);

        expect(res.status).toBe(200);
        const newCode = res.body.data.publicCode;
        expect(newCode).not.toBe(event.publicCode);
        expect(res.body.data.publicUrl).toContain(newCode);

        expect((await request(app).get(`/api/public/events/${event.publicCode}`)).status).toBe(404);
        expect((await request(app).get(`/api/public/events/${newCode}`)).status).toBe(200);
        expect((await request(app).get('/api/guest/me').set('Authorization', `Bearer ${guestToken}`)).status).toBe(200);
    });

    it('works on a pending event, 409 on a suspended one', async () => {
        const client = await createUserWithToken(ROLE.USER);
        const pending = (await request(app).post('/api/events').set('Authorization', client.auth).send(eventBody())).body.data;
        expect((await request(app).post(`/api/events/${pending.id}/qr/rotate`).set('Authorization', client.auth)).status).toBe(200);

        await db.orm.public.Event.where({ id: event.id }).update({ status: EVENT_STATUS.SUSPENDED });
        expect((await request(app).post(`/api/events/${event.id}/qr/rotate`).set('Authorization', ownerAuth)).status).toBe(409);
    });
});
