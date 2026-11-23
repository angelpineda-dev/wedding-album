import crypto from 'node:crypto';
import { and } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { mediaMessages } from '../core/userMessages/media.ts';
import { UPLOAD_WINDOW } from '../core/const/event.ts';
import {
    ALLOWED_TYPES,
    MAX_OPEN_UPLOADS,
    MAX_SIZE_BYTES,
    MEDIA_STATUS,
    type MediaKind,
} from '../core/const/media.ts';
import type { ReqGuest } from '../types/guest.ts';
import type { Coordinates } from '../utils/geo.ts';
import { evaluatePresence } from './guestService.ts';
import { createDownloadUrl, createUploadUrl, deleteObject, headObject } from './storageService.ts';

export interface UploadRequest {
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
    position: Coordinates;
}

/** Why a guest cannot upload, as the guest screens explain it. */
function assertCanUpload(guest: ReqGuest, position: Coordinates) {
    const presence = evaluatePresence(guest.event, position);
    if (presence.uploadWindow !== UPLOAD_WINDOW.OPEN) {
        throw new AppError(mediaMessages.OUTSIDE_WINDOW, 403);
    }
    if (!presence.inside) {
        throw new AppError(mediaMessages.OUTSIDE_GEOFENCE, 403);
    }
}

/**
 * Registers an upload and returns where to PUT the file. Checks, in order: type and size for
 * the kind, the event window and geofence, and how many uploads the guest already has open.
 */
export async function startUpload(guest: ReqGuest, request: UploadRequest) {
    const extension = ALLOWED_TYPES[request.kind][request.mimeType];
    if (extension === undefined) {
        throw new AppError(mediaMessages.TYPE_NOT_ALLOWED, 415);
    }
    if (request.sizeBytes > MAX_SIZE_BYTES[request.kind]) {
        throw new AppError(mediaMessages.TOO_LARGE, 413);
    }

    assertCanUpload(guest, request.position);

    const { open } = await db.orm.public.Media
        .where((m) => and(m.guestId.eq(guest.id), m.status.eq(MEDIA_STATUS.UPLOADING)))
        .aggregate((aggregate) => ({ open: aggregate.count() }));
    if (open >= MAX_OPEN_UPLOADS) {
        throw new AppError(mediaMessages.TOO_MANY_OPEN, 429);
    }

    const storageKey = `events/${guest.event.id}/${crypto.randomUUID()}.${extension}`;

    const media = await db.orm.public.Media.create({
        eventId: guest.event.id,
        guestId: guest.id,
        kind: request.kind,
        storageKey,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        uploadedAt: null,
        publishedAt: null,
        moderatedById: null,
    });

    return {
        media: { id: media.id, kind: media.kind, status: media.status },
        upload: await createUploadUrl(storageKey, request.mimeType, request.sizeBytes),
    };
}

async function findOwnMedia(guestId: string, id: string) {
    const media = await db.orm.public.Media.where({ id, guestId }).first();
    if (!media) {
        throw new AppError(mediaMessages.NOT_FOUND, 404);
    }
    return media;
}

/**
 * Confirms the file reached storage with the announced size and type, then sends it to
 * moderation or straight to the gallery (per the event). Idempotent once completed.
 * A file that does not match is deleted along with its record.
 */
export async function completeUpload(guest: ReqGuest, id: string) {
    const media = await findOwnMedia(guest.id, id);

    if (media.status !== MEDIA_STATUS.UPLOADING) {
        return { id: media.id, kind: media.kind, status: media.status };
    }

    const stored = await headObject(media.storageKey);
    if (!stored) {
        throw new AppError(mediaMessages.NOT_UPLOADED, 409);
    }

    if (stored.sizeBytes !== media.sizeBytes || stored.mimeType !== media.mimeType) {
        await deleteObject(media.storageKey);
        await db.orm.public.Media.where({ id: media.id }).delete();
        throw new AppError(mediaMessages.MISMATCH, 422);
    }

    const now = new Date();
    const status = guest.event.moderationRequired ? MEDIA_STATUS.PENDING : MEDIA_STATUS.PUBLISHED;

    const updated = await db.orm.public.Media
        .where((m) => and(m.id.eq(media.id), m.status.eq(MEDIA_STATUS.UPLOADING)))
        .update({ status, uploadedAt: now, publishedAt: status === MEDIA_STATUS.PUBLISHED ? now : null });

    // Lost a race with a concurrent completion: report what the other request stored.
    const current = updated ?? (await findOwnMedia(guest.id, id));
    return { id: current.id, kind: current.kind, status: current.status };
}

/** The guest's own uploads (any status but UPLOADING), newest first, with a viewing URL. */
export async function listOwnMedia(guestId: string) {
    const media = await db.orm.public.Media
        .where((m) => and(m.guestId.eq(guestId), m.status.neq(MEDIA_STATUS.UPLOADING)))
        .orderBy((m) => m.createdAt.desc())
        .all();

    return Promise.all(media.map(async (item) => ({
        id: item.id,
        kind: item.kind,
        status: item.status,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        url: await createDownloadUrl(item.storageKey),
    })));
}
