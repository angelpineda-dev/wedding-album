import type { Request, Response } from 'express';
import { z } from 'zod';
import { checkPresence, findPublicEvent, joinEvent, toPublicEvent } from '../services/guestService.ts';

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

export { getPublicEvent, postJoin, getMe, postPresence };
