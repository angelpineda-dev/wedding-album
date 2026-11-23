import type { Request, Response } from 'express';
import { z } from 'zod';
import { eventMessages } from '../core/userMessages/event.ts';
import { GALLERY_POLL_SECONDS, RADIUS_METERS } from '../core/const/event.ts';
import {
    createEvent,
    getOwnedEvent,
    getOwnedEventForQr,
    listOwnEvents,
    rotatePublicCode,
    updateOwnedEvent,
} from '../services/eventService.ts';
import { renderQrPdf, renderQrPng } from '../services/qrService.ts';

const isTimeZone = (value: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
};

// Timestamps must carry an offset (or Z) so they are not read in the server's time zone.
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** Every field a client may set; `create` requires the core ones, `update` makes all optional. */
const settingsShape = {
    name: z.string().trim().min(1).max(120),
    opensAt: timestamp,
    closesAt: timestamp,
    timezone: z.string().max(64).refine(isTimeZone, eventMessages.INVALID_TIMEZONE),
    venueName: z.string().trim().min(1).max(160).nullable(),
    geofenceEnabled: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    radiusMeters: z.number().int().min(RADIUS_METERS.MIN).max(RADIUS_METERS.MAX),
    moderationRequired: z.boolean(),
    galleryPollSeconds: z.number().int().min(GALLERY_POLL_SECONDS.MIN).max(GALLERY_POLL_SECONDS.MAX),
};

const createBody = z.strictObject({
    ...settingsShape,
    venueName: settingsShape.venueName.default(null),
    geofenceEnabled: settingsShape.geofenceEnabled.default(false),
    latitude: settingsShape.latitude.default(null),
    longitude: settingsShape.longitude.default(null),
    radiusMeters: settingsShape.radiusMeters.default(5000),
    moderationRequired: settingsShape.moderationRequired.default(true),
    galleryPollSeconds: settingsShape.galleryPollSeconds.default(120),
});

const updateBody = z.strictObject(settingsShape).partial().refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change.',
});

const idParam = z.strictObject({ id: z.uuid() });

const postEvent = async (req: Request, res: Response) => {
    const settings = createBody.parse(req.body);
    const event = await createEvent(req.user!.id, settings);
    return res.status(201).json({ success: true, data: event });
};

const getEvents = async (req: Request, res: Response) => {
    return res.json({ success: true, data: await listOwnEvents(req.user!.id) });
};

const getEvent = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    return res.json({ success: true, data: await getOwnedEvent(req.user!.id, id) });
};

const patchEvent = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const changes = updateBody.parse(req.body);

    // Drop keys Zod left as undefined so they are not written as NULL.
    const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined));

    return res.json({ success: true, data: await updateOwnedEvent(req.user!.id, id, defined) });
};

/** "Descargar PNG": the QR alone, as a download. */
const getQrPng = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const event = await getOwnedEventForQr(req.user!.id, id);
    const png = await renderQrPng(event.publicCode);

    res.attachment(`qr-${event.publicCode}.png`).type('png').send(png);
};

/** "PDF para imprimir": a letter page with the event name, QR, link and upload hours. */
const getQrPdf = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const event = await getOwnedEventForQr(req.user!.id, id);
    const pdf = await renderQrPdf(event);

    res.attachment(`qr-${event.publicCode}.pdf`).type('pdf').send(pdf);
};

/** "Regenerar QR". */
const postRotateQr = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    return res.json({ success: true, data: await rotatePublicCode(req.user!.id, id) });
};

export { postEvent, getEvents, getEvent, patchEvent, getQrPng, getQrPdf, postRotateQr };
