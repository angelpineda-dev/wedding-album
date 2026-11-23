import { and, or } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { eventMessages } from '../core/userMessages/event.ts';
import { mediaMessages } from '../core/userMessages/media.ts';
import { ROLE } from '../core/const/roles.ts';
import { EVENT_STATUS } from '../core/const/event.ts';
import { MEDIA_STATUS, type MediaStatus } from '../core/const/media.ts';
import type { ReqUser } from '../types/user.ts';
import { encodeCursor, type Cursor } from '../utils/cursor.ts';
import { createDownloadUrl } from './storageService.ts';

type EventRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Event.first>>>;
type MediaRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Media.first>>>;

/**
 * Who may moderate an event: its owner (the client) and SUPER_ADMIN. ADMIN is reserved for
 * moderation staff offered as a service; enabling it is one line here.
 */
function canModerate(user: ReqUser, event: EventRow): boolean {
    switch (user.role) {
        case ROLE.USER:
            return event.ownerId === user.id;
        case ROLE.SUPER_ADMIN:
            return true;
        case ROLE.ADMIN:
            return false;
        default: {
            const unhandled: never = user.role;
            throw new Error(`Unhandled role: ${unhandled}`);
        }
    }
}

/** The event if `user` may moderate it; 404 otherwise, so ids of other events cannot be probed. */
export async function loadModeratableEvent(user: ReqUser, eventId: string) {
    const event = await db.orm.public.Event.where({ id: eventId }).first();
    if (!event || !canModerate(user, event)) {
        throw new AppError(eventMessages.NOT_FOUND, 404);
    }
    return event;
}

const toModerationItem = async (item: MediaRow & { guest: { name: string } | null }) => ({
    id: item.id,
    eventId: item.eventId,
    kind: item.kind,
    status: item.status,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    guestName: item.guest?.name ?? null,
    createdAt: item.createdAt,
    publishedAt: item.publishedAt,
    url: await createDownloadUrl(item.storageKey),
});

export interface ModerationQuery {
    status: Exclude<MediaStatus, typeof MEDIA_STATUS.UPLOADING>;
    before?: Cursor;
    limit: number;
}

/** Media of one event in one status, newest upload first, keyset-paginated on (createdAt, id). */
export async function listEventMedia(eventId: string, query: ModerationQuery) {
    const { before } = query;
    const rows = await db.orm.public.Media
        .where((m) => and(
            m.eventId.eq(eventId),
            m.status.eq(query.status),
            ...(before ? [or(m.createdAt.lt(before.at), and(m.createdAt.eq(before.at), m.id.lt(before.id)))] : []),
        ))
        .orderBy([(m) => m.createdAt.desc(), (m) => m.id.desc()])
        .include('guest', (guest) => guest.select('name'))
        .limit(query.limit)
        .all();

    const oldest = rows.at(-1);
    return {
        items: await Promise.all(rows.map(toModerationItem)),
        nextCursor: oldest && rows.length === query.limit ? encodeCursor({ at: oldest.createdAt, id: oldest.id }) : null,
    };
}

async function findEventMedia(eventId: string, mediaId: string) {
    const media = await db.orm.public.Media.where({ id: mediaId, eventId }).first();
    if (!media) {
        throw new AppError(mediaMessages.NOT_FOUND, 404);
    }
    if (media.status === MEDIA_STATUS.UPLOADING) {
        throw new AppError(mediaMessages.NOT_MODERATABLE, 409);
    }
    return media;
}

/** Publishes a pending or hidden item. `publishedAt` is set now so polling galleries pick it up. */
export async function approveMedia(user: ReqUser, eventId: string, mediaId: string) {
    const media = await findEventMedia(eventId, mediaId);
    if (media.status === MEDIA_STATUS.PUBLISHED) {
        return { id: media.id, status: media.status };
    }

    const updated = await db.orm.public.Media.where({ id: media.id }).update({
        status: MEDIA_STATUS.PUBLISHED,
        publishedAt: new Date(),
        moderatedById: user.id,
    });
    return { id: updated!.id, status: updated!.status };
}

/** Takes an item out of the gallery (or keeps it out). The file is kept. */
export async function hideMedia(user: ReqUser, eventId: string, mediaId: string) {
    const media = await findEventMedia(eventId, mediaId);

    const updated = await db.orm.public.Media.where({ id: media.id }).update({
        status: MEDIA_STATUS.HIDDEN,
        moderatedById: user.id,
    });
    return { id: updated!.id, status: updated!.status };
}

/** Publishes every pending item of the event at once. */
export async function approveAllPending(user: ReqUser, eventId: string) {
    const approved = await db.orm.public.Media
        .where((m) => and(m.eventId.eq(eventId), m.status.eq(MEDIA_STATUS.PENDING)))
        .updateAndCount({ status: MEDIA_STATUS.PUBLISHED, publishedAt: new Date(), moderatedById: user.id });

    return { approved };
}

/** SUPER_ADMIN queue: pending media of every enabled event, oldest first (first in, first reviewed). */
export async function listPendingQueue(query: { eventId?: string; limit: number; after?: Cursor }) {
    const { after, eventId } = query;
    const rows = await db.orm.public.Media
        .where((m) => and(
            m.status.eq(MEDIA_STATUS.PENDING),
            ...(eventId ? [m.eventId.eq(eventId)] : []),
            ...(after ? [or(m.createdAt.gt(after.at), and(m.createdAt.eq(after.at), m.id.gt(after.id)))] : []),
        ))
        .orderBy([(m) => m.createdAt.asc(), (m) => m.id.asc()])
        .include('guest', (guest) => guest.select('name'))
        .include('event', (event) => event.select('id', 'name', 'status'))
        .limit(query.limit)
        .all();

    const enabled = rows.filter((row) => row.event?.status === EVENT_STATUS.ENABLED);
    const last = rows.at(-1);

    return {
        items: await Promise.all(enabled.map(async ({ event, ...row }) => ({
            ...(await toModerationItem(row)),
            eventName: event?.name ?? null,
        }))),
        nextCursor: last && rows.length === query.limit ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    };
}
