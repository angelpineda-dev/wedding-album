import type { Request, Response } from 'express';
import { z } from 'zod';
import { MEDIA_STATUS, PAGE_SIZE } from '../core/const/media.ts';
import { cursorParam } from '../utils/cursor.ts';
import {
    approveAllPending,
    approveMedia,
    hideMedia,
    listEventMedia,
    listPendingQueue,
    loadModeratableEvent,
} from '../services/moderationService.ts';

const eventParam = z.strictObject({ eventId: z.uuid() });
const mediaParams = z.strictObject({ eventId: z.uuid(), mediaId: z.uuid() });
const limit = z.coerce.number().int().min(1).max(PAGE_SIZE.MAX).default(PAGE_SIZE.DEFAULT);
const listQuery = z.strictObject({
    status: z.enum([MEDIA_STATUS.PENDING, MEDIA_STATUS.PUBLISHED, MEDIA_STATUS.HIDDEN]).default(MEDIA_STATUS.PENDING),
    before: cursorParam.optional(),
    limit,
});
const queueQuery = z.strictObject({ eventId: z.uuid().optional(), after: cursorParam.optional(), limit });

const getEventMedia = async (req: Request, res: Response) => {
    const { eventId } = eventParam.parse(req.params);
    const { status, before, limit } = listQuery.parse(req.query);
    await loadModeratableEvent(req.user!, eventId);
    return res.json({ success: true, data: await listEventMedia(eventId, { status, limit, ...(before && { before }) }) });
};

const postApprove = async (req: Request, res: Response) => {
    const { eventId, mediaId } = mediaParams.parse(req.params);
    await loadModeratableEvent(req.user!, eventId);
    return res.json({ success: true, data: await approveMedia(req.user!, eventId, mediaId) });
};

const postHide = async (req: Request, res: Response) => {
    const { eventId, mediaId } = mediaParams.parse(req.params);
    await loadModeratableEvent(req.user!, eventId);
    return res.json({ success: true, data: await hideMedia(req.user!, eventId, mediaId) });
};

const postApproveAll = async (req: Request, res: Response) => {
    const { eventId } = eventParam.parse(req.params);
    await loadModeratableEvent(req.user!, eventId);
    return res.json({ success: true, data: await approveAllPending(req.user!, eventId) });
};

/** SUPER_ADMIN: pending media across events. */
const getModerationQueue = async (req: Request, res: Response) => {
    const { eventId, after, limit } = queueQuery.parse(req.query);
    return res.json({ success: true, data: await listPendingQueue({ limit, ...(eventId && { eventId }), ...(after && { after }) }) });
};

export { getEventMedia, postApprove, postHide, postApproveAll, getModerationQueue };
