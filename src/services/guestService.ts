import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { guestMessages } from '../core/userMessages/guest.ts';
import {
    EVENT_STATUS,
    GUEST_TOKEN_GRACE_DAYS,
    GUEST_TOLERANCE,
    UPLOAD_WINDOW,
    type UploadWindow,
} from '../core/const/event.ts';
import { generateRefreshToken, hashToken } from './tokenService.ts';
import { distanceMeters, type Coordinates } from '../utils/geo.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

type EventRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Event.first>>>;

export function uploadWindow(event: Pick<EventRow, 'opensAt' | 'closesAt'>, now = new Date()): UploadWindow {
    if (now < event.opensAt) return UPLOAD_WINDOW.UPCOMING;
    if (now >= event.closesAt) return UPLOAD_WINDOW.CLOSED;
    return UPLOAD_WINDOW.OPEN;
}

/** Codes are printed in upper case; accept what people type. */
const normalizeCode = (code: string) => code.trim().toUpperCase();

/**
 * What anyone holding the QR may see. The venue's coordinates are left out on purpose:
 * guests learn only whether they are inside, from `POST /guest/presence`.
 */
export const toPublicEvent = (event: EventRow) => ({
    code: event.publicCode,
    type: event.type,
    name: event.name,
    venueName: event.venueName,
    opensAt: event.opensAt,
    closesAt: event.closesAt,
    timezone: event.timezone,
    uploadWindow: uploadWindow(event),
    geofenceEnabled: event.geofenceEnabled,
    radiusMeters: event.geofenceEnabled ? event.radiusMeters : null,
    moderationRequired: event.moderationRequired,
    galleryPollSeconds: event.galleryPollSeconds,
});

/** The ENABLED event behind a public code, or 404 (pending, suspended and unknown look the same). */
export async function findPublicEvent(code: string) {
    const event = await db.orm.public.Event.where({ publicCode: normalizeCode(code), status: EVENT_STATUS.ENABLED }).first();
    if (!event) {
        throw new AppError(guestMessages.EVENT_NOT_FOUND, 404);
    }
    return event;
}

/**
 * Registers a guest and returns their raw token (only its hash is stored).
 * The event row is locked so concurrent joins cannot go over `packageMax + GUEST_TOLERANCE`.
 */
export async function joinEvent(code: string, name: string) {
    return db.transaction(async (tx) => {
        const event = await tx.orm.public.Event
            .where({ publicCode: normalizeCode(code), status: EVENT_STATUS.ENABLED })
            .forUpdate()
            .first();

        if (!event || event.packageMax === null) {
            throw new AppError(guestMessages.EVENT_NOT_FOUND, 404);
        }
        if (uploadWindow(event) === UPLOAD_WINDOW.CLOSED) {
            throw new AppError(guestMessages.EVENT_CLOSED, 409);
        }

        const { joined } = await tx.orm.public.Guest
            .where({ eventId: event.id })
            .aggregate((aggregate) => ({ joined: aggregate.count() }));

        if (joined >= event.packageMax + GUEST_TOLERANCE) {
            throw new AppError(guestMessages.EVENT_FULL, 409);
        }

        const token = generateRefreshToken();
        const expiresAt = new Date(event.closesAt.getTime() + GUEST_TOKEN_GRACE_DAYS * DAY_MS);

        const guest = await tx.orm.public.Guest.create({
            eventId: event.id,
            name,
            tokenHash: hashToken(token),
            expiresAt,
            lastSeenAt: null,
        });

        return { token, expiresAt, guest: { id: guest.id, name: guest.name }, event: toPublicEvent(event) };
    });
}

/** The guest of a token with its event, or null if unknown, expired, or the event is no longer ENABLED. */
export async function findGuestByToken(token: string) {
    const guest = await db.orm.public.Guest.where({ tokenHash: hashToken(token) }).include('event').first();

    if (!guest || guest.expiresAt <= new Date() || guest.event.status !== EVENT_STATUS.ENABLED) {
        return null;
    }
    return guest;
}

/**
 * Whether a guest at `position` may upload now. The position is checked and dropped:
 * it is never stored (the guest screens promise this).
 */
export async function checkPresence(guestId: string, event: EventRow, position: Coordinates) {
    const window = uploadWindow(event);

    const distance = event.geofenceEnabled && event.latitude !== null && event.longitude !== null
        ? Math.round(distanceMeters(position, { latitude: event.latitude, longitude: event.longitude }))
        : null;
    const inside = distance === null || distance <= event.radiusMeters;

    await db.orm.public.Guest.where({ id: guestId }).update({ lastSeenAt: new Date() });

    return {
        canUpload: inside && window === UPLOAD_WINDOW.OPEN,
        inside,
        distanceMeters: distance,
        radiusMeters: event.geofenceEnabled ? event.radiusMeters : null,
        uploadWindow: window,
        opensAt: event.opensAt,
        closesAt: event.closesAt,
    };
}
