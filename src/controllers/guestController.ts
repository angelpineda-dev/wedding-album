import type { Request, Response } from 'express';
import { z } from 'zod';
import { checkPresence, findPublicEvent, joinEvent, toPublicEvent } from '../services/guestService.ts';
import { completeUpload, listOwnMedia, startUpload } from '../services/mediaService.ts';
import { MEDIA_KIND, PAGE_SIZE } from '../core/const/media.ts';
import { listGallery } from '../services/galleryService.ts';
import { cursorParam } from '../utils/cursor.ts';

const codeParam = z.strictObject({ code: z.string().trim().min(4).max(16) });
const joinBody = z.strictObject({ name: z.string().trim().min(1).max(80) });
const presenceBody = z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
});

/** Public: what the QR opens (gallery header, window, geofence on/off, poll interval). */
const getPublicEvent = async (req: Request, res: Response) => {
    const { code } = codeParam.parse(req.params);
    return res.json({ success: true, data: toPublicEvent(await findPublicEvent(code)) });
};

/** Public: called when a guest taps "Subir" and gives their name. */
const postJoin = async (req: Request, res: Response) => {
    const { code } = codeParam.parse(req.params);
    const { name } = joinBody.parse(req.body);
    return res.status(201).json({ success: true, data: await joinEvent(code, name) });
};

const getMe = async (req: Request, res: Response) => {
    const { id, name, event } = req.guest!;
    return res.json({ success: true, data: { guest: { id, name }, event: toPublicEvent(event) } });
};

const postPresence = async (req: Request, res: Response) => {
    const position = presenceBody.parse(req.body);
    const { id, event } = req.guest!;
    return res.json({ success: true, data: await checkPresence(id, event, position) });
};

const uploadBody = z.strictObject({
    kind: z.enum(MEDIA_KIND),
    mimeType: z.string().trim().toLowerCase().max(100),
    sizeBytes: z.number().int().positive(),
    latitude: presenceBody.shape.latitude,
    longitude: presenceBody.shape.longitude,
});
const mediaIdParam = z.strictObject({ id: z.uuid() });

/** Step 1 of an upload: get a URL to PUT the file to. */
const postMedia = async (req: Request, res: Response) => {
    const { kind, mimeType, sizeBytes, latitude, longitude } = uploadBody.parse(req.body);
    const result = await startUpload(req.guest!, { kind, mimeType, sizeBytes, position: { latitude, longitude } });
    return res.status(201).json({ success: true, data: result });
};

/** Step 2: after the PUT succeeded. */
const postCompleteMedia = async (req: Request, res: Response) => {
    const { id } = mediaIdParam.parse(req.params);
    return res.json({ success: true, data: await completeUpload(req.guest!, id) });
};

const getMyMedia = async (req: Request, res: Response) => {
    return res.json({ success: true, data: await listOwnMedia(req.guest!.id) });
};

const galleryQuery = z.strictObject({
    before: cursorParam.optional(),
    since: cursorParam.optional(),
    kind: z.enum(MEDIA_KIND).optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_SIZE.MAX).default(PAGE_SIZE.DEFAULT),
}).refine((query) => !(query.before && query.since), { message: 'Use either before or since, not both.' });

/** Public: the gallery the QR opens. No guest token needed: viewing comes before joining. */
const getGallery = async (req: Request, res: Response) => {
    const { code } = codeParam.parse(req.params);
    const { before, since, kind, limit } = galleryQuery.parse(req.query);
    const event = await findPublicEvent(code);

    const page = await listGallery(event.id, {
        limit,
        ...(before && { before }),
        ...(since && { since }),
        ...(kind && { kind }),
    });

    return res.json({ success: true, data: { ...page, pollSeconds: event.galleryPollSeconds } });
};

export { getGallery, getPublicEvent, postJoin, getMe, postPresence, postMedia, postCompleteMedia, getMyMedia };
