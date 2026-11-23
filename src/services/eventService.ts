import crypto from 'node:crypto';
import { and } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import AppError from '../errors/AppError.ts';
import { eventMessages } from '../core/userMessages/event.ts';
import { authMessages } from '../core/userMessages/auth.ts';
import { ROLE } from '../core/const/roles.ts';
import { USER_STATUS } from '../core/const/userStatus.ts';
import { EVENT_STATUS, GUEST_TOLERANCE, MAX_WINDOW_HOURS, type EventStatus } from '../core/const/event.ts';
import { isUniqueViolation } from '../utils/dbErrors.ts';

const HOUR_MS = 60 * 60 * 1000;

/** What a client sets on an event. Everything else (status, package, code) is server-managed. */
export interface EventSettings {
    name: string;
    opensAt: Date;
    closesAt: Date;
    timezone: string;
    venueName: string | null;
    geofenceEnabled: boolean;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number;
    moderationRequired: boolean;
    galleryPollSeconds: number;
}

type EventRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Event.first>>>;

/** Adds the guest limit the package grants (null until a SUPER_ADMIN enables the event). */
export const toEventResponse = (event: EventRow) => ({
    ...event,
    guestLimit: event.packageMax === null ? null : event.packageMax + GUEST_TOLERANCE,
});

/** Rules that span several fields; checked on create and on the merged result of an update. */
function assertValidSettings(settings: Pick<EventSettings, 'opensAt' | 'closesAt' | 'geofenceEnabled' | 'latitude' | 'longitude'>) {
    if (settings.closesAt <= settings.opensAt) {
        throw new AppError(eventMessages.WINDOW_ORDER, 400);
    }
    if (settings.closesAt.getTime() - settings.opensAt.getTime() > MAX_WINDOW_HOURS * HOUR_MS) {
        throw new AppError(eventMessages.WINDOW_TOO_LONG, 400);
    }
    if (settings.geofenceEnabled && (settings.latitude === null || settings.longitude === null)) {
        throw new AppError(eventMessages.GEOFENCE_NEEDS_LOCATION, 400);
    }
}

// No 0/O or 1/I: the code is printed under the QR and may be typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 3;

export const generatePublicCode = (): string =>
    Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');

/**
 * Creates a PENDING event if the client still has quota. The client row is locked so two
 * concurrent requests cannot both take the last slot. A public-code collision (32^6 codes)
 * aborts the transaction, so the whole attempt is retried with a new code.
 */
export async function createEvent(ownerId: number, settings: EventSettings) {
    assertValidSettings(settings);

    for (let attempt = 1; ; attempt += 1) {
        try {
            return await db.transaction(async (tx) => {
                const owner = await tx.orm.public.User.where({ id: ownerId }).forUpdate().first();
                if (!owner) {
                    throw new AppError(authMessages.USER_NOT_FOUND, 404);
                }

                const { used } = await tx.orm.public.Event
                    .where({ ownerId })
                    .aggregate((aggregate) => ({ used: aggregate.count() }));

                if (used >= owner.eventQuota) {
                    throw new AppError(eventMessages.QUOTA_REACHED, 409);
                }

                const event = await tx.orm.public.Event.create({
                    ...settings,
                    ownerId,
                    publicCode: generatePublicCode(),
                    packageMax: null,
                    enabledAt: null,
                });

                return toEventResponse(event);
            });
        } catch (error) {
            if (attempt < CODE_ATTEMPTS && isUniqueViolation(error)) {
                continue;
            }
            throw error;
        }
    }
}

export async function listOwnEvents(ownerId: number) {
    const events = await db.orm.public.Event.where({ ownerId }).orderBy((e) => e.opensAt.desc()).all();
    return events.map(toEventResponse);
}

/** The client's own event, or 404 (also for other clients' events, so ids cannot be probed). */
async function findOwnedEvent(ownerId: number, id: string) {
    const event = await db.orm.public.Event.where({ id, ownerId }).first();
    if (!event) {
        throw new AppError(eventMessages.NOT_FOUND, 404);
    }
    return event;
}

export async function getOwnedEvent(ownerId: number, id: string) {
    return toEventResponse(await findOwnedEvent(ownerId, id));
}

export async function updateOwnedEvent(ownerId: number, id: string, changes: Partial<EventSettings>) {
    const event = await findOwnedEvent(ownerId, id);

    if (event.status === EVENT_STATUS.SUSPENDED) {
        throw new AppError(eventMessages.SUSPENDED, 409);
    }

    assertValidSettings({ ...event, ...changes });

    const updated = await db.orm.public.Event.where({ id, ownerId }).update(changes);
    return toEventResponse(updated!);
}

// ── Platform administration (SUPER_ADMIN) ──────────────────────────────────

export async function listEvents(status?: EventStatus) {
    const base = status === undefined ? db.orm.public.Event : db.orm.public.Event.where({ status });
    const events = await base
        .include('owner', (owner) => owner.select('id', 'name', 'lastName', 'email'))
        .orderBy((e) => e.createdAt.desc())
        .all();

    return events.map(({ owner, ...event }) => ({ ...toEventResponse(event), owner }));
}

async function findEvent(id: string) {
    const event = await db.orm.public.Event.where({ id }).first();
    if (!event) {
        throw new AppError(eventMessages.NOT_FOUND, 404);
    }
    return event;
}

/** Confirms the paid package and opens the event to guests. Calling it again changes the package. */
export async function enableEvent(id: string, packageMax: number) {
    const event = await findEvent(id);

    const updated = await db.orm.public.Event.where({ id }).update({
        status: EVENT_STATUS.ENABLED,
        packageMax,
        enabledAt: event.enabledAt ?? new Date(),
    });

    return toEventResponse(updated!);
}

export async function suspendEvent(id: string) {
    await findEvent(id);
    const updated = await db.orm.public.Event.where({ id }).update({ status: EVENT_STATUS.SUSPENDED });
    return toEventResponse(updated!);
}

/** Numbers for the admin dashboard. Storage usage is added with media (phase 7). */
export async function getStats() {
    const [{ activeClients }, { pendingEvents }, { enabledEvents }] = await Promise.all([
        db.orm.public.User
            .where((u) => and(u.role.eq(ROLE.USER), u.status.eq(USER_STATUS.ACTIVE), u.deletedAt.isNull()))
            .aggregate((aggregate) => ({ activeClients: aggregate.count() })),
        db.orm.public.Event
            .where({ status: EVENT_STATUS.PENDING })
            .aggregate((aggregate) => ({ pendingEvents: aggregate.count() })),
        db.orm.public.Event
            .where({ status: EVENT_STATUS.ENABLED })
            .aggregate((aggregate) => ({ enabledEvents: aggregate.count() })),
    ]);

    return { activeClients, pendingEvents, enabledEvents };
}
