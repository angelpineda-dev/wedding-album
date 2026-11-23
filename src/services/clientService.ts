import { and } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { ROLE } from '../core/const/roles.ts';
import { USER_STATUS, type UserStatus } from '../core/const/userStatus.ts';
import { revokeAllSessions } from './sessionService.ts';
import { sendMagicLink } from './magicLinkService.ts';
import { storageBytesByOwner } from './usageService.ts';

const CLIENT_FIELDS = ['id', 'email', 'name', 'lastName', 'status', 'eventQuota', 'createdAt'] as const;

/** Clients are users with role USER that were not deleted. */
const clients = () =>
    db.orm.public.User.where((u) => and(u.role.eq(ROLE.USER), u.deletedAt.isNull()));

/** Clients with how many events they created and how many bytes their events store. */
export async function listClients(status?: UserStatus) {
    const query = status === undefined ? clients() : clients().where({ status });
    const [rows, storage] = await Promise.all([
        query.select(...CLIENT_FIELDS)
            .include('events', (events) => events.count())
            .orderBy((u) => u.createdAt.desc())
            .all(),
        storageBytesByOwner(),
    ]);

    return rows.map(({ events, ...client }) => ({
        ...client,
        eventCount: events,
        storageBytes: storage.get(client.id) ?? 0,
    }));
}

async function findClient(id: number) {
    const client = await clients().where({ id }).select(...CLIENT_FIELDS).first();
    if (!client) {
        throw new AppError(authMessages.USER_NOT_FOUND, 404);
    }
    return client;
}

export interface ClientChanges {
    eventQuota?: number;
    status?: UserStatus;
}

/** Updates quota and/or status. Suspending revokes every session and access token right away. */
export async function updateClient(id: number, changes: ClientChanges) {
    await findClient(id);

    const updated = await clients().where({ id }).select(...CLIENT_FIELDS).update(changes);

    if (changes.status === USER_STATUS.SUSPENDED) {
        await revokeAllSessions(id);
    }

    return updated!;
}

/** Emails a new magic link to an active client. */
export async function resendInvitation(id: number): Promise<void> {
    const client = await findClient(id);

    if (client.status !== USER_STATUS.ACTIVE) {
        throw new AppError(authMessages.USER_SUSPENDED, 409);
    }

    await sendMagicLink(client);
}
