import type { Request, Response } from 'express';
import { z } from 'zod';
import { USER_STATUS } from '../core/const/userStatus.ts';
import { EVENT_QUOTA } from './authController.ts';
import { listClients, resendInvitation, updateClient } from '../services/clientService.ts';
import { EVENT_STATUS, PACKAGE_MAX, PACKAGE_STEP } from '../core/const/event.ts';
import { eventMessages } from '../core/userMessages/event.ts';
import { enableEvent, getStats, listEvents, suspendEvent } from '../services/eventService.ts';

const idParam = z.strictObject({ id: z.coerce.number().int().positive() });
const listQuery = z.strictObject({ status: z.enum(USER_STATUS).optional() });
const updateBody = z.strictObject({
    eventQuota: EVENT_QUOTA.optional(),
    status: z.enum(USER_STATUS).optional(),
}).refine((body) => body.eventQuota !== undefined || body.status !== undefined, {
    message: 'Send eventQuota and/or status.',
});

const getClients = async (req: Request, res: Response) => {
    const { status } = listQuery.parse(req.query);
    return res.json({ success: true, data: await listClients(status) });
};

const patchClient = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    const { eventQuota, status } = updateBody.parse(req.body);

    const client = await updateClient(id, {
        ...(eventQuota !== undefined && { eventQuota }),
        ...(status !== undefined && { status }),
    });

    return res.json({ success: true, data: client });
};

const resendClientInvitation = async (req: Request, res: Response) => {
    const { id } = idParam.parse(req.params);
    await resendInvitation(id);
    return res.status(202).json({ success: true });
};

const eventIdParam = z.strictObject({ id: z.uuid() });
const eventListQuery = z.strictObject({ status: z.enum(EVENT_STATUS).optional() });
const enableBody = z.strictObject({
    packageMax: z.number().int().min(PACKAGE_STEP).max(PACKAGE_MAX)
        .refine((value) => value % PACKAGE_STEP === 0, eventMessages.PACKAGE_STEP),
});

const getEvents = async (req: Request, res: Response) => {
    const { status } = eventListQuery.parse(req.query);
    return res.json({ success: true, data: await listEvents(status) });
};

const postEnableEvent = async (req: Request, res: Response) => {
    const { id } = eventIdParam.parse(req.params);
    const { packageMax } = enableBody.parse(req.body);
    return res.json({ success: true, data: await enableEvent(id, packageMax) });
};

const postSuspendEvent = async (req: Request, res: Response) => {
    const { id } = eventIdParam.parse(req.params);
    return res.json({ success: true, data: await suspendEvent(id) });
};

const getDashboardStats = async (_req: Request, res: Response) => {
    return res.json({ success: true, data: await getStats() });
};

export {
    getClients,
    patchClient,
    resendClientInvitation,
    getEvents,
    postEnableEvent,
    postSuspendEvent,
    getDashboardStats,
};
