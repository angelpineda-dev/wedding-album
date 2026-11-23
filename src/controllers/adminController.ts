import type { Request, Response } from 'express';
import { z } from 'zod';
import { USER_STATUS } from '../core/const/userStatus.ts';
import { EVENT_QUOTA } from './authController.ts';
import { listClients, resendInvitation, updateClient } from '../services/clientService.ts';

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

export { getClients, patchClient, resendClientInvitation };
