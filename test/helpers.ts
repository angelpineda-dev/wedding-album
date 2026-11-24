import { vi } from 'vitest';
import { db } from '../src/prisma/db.ts';
import { createUser, signsInWithMagicLink } from '../src/services/authService.ts';
import { signAccessToken } from '../src/services/tokenService.ts';
import { mailService } from '../src/services/mailService.ts';
import { createEvent } from '../src/services/eventService.ts';
import { ROLE, type Role } from '../src/core/const/roles.ts';
import { EVENT_STATUS, RADIUS_METERS } from '../src/core/const/event.ts';
import { MEDIA_KIND, MEDIA_STATUS, type MediaKind, type MediaStatus } from '../src/core/const/media.ts';
import { assertTestDatabase } from './testEnv.ts';

export const STAFF_PASSWORD = 'correct-horse-battery';

export async function resetDatabase(): Promise<void> {
    assertTestDatabase(process.env['DATABASE_URL']!);
    await db.execute(db.raw.sql`TRUNCATE TABLE media, guests, events, magic_links, sessions, users RESTART IDENTITY CASCADE`.affectedCount().build());
}

/** Replaces email sending with a spy; read the links with `sentMagicLinks()`. */
export function mockMail() {
    return vi.spyOn(mailService, 'sendMagicLink').mockResolvedValue();
}

/** Tokens of every magic link "emailed" so far, in order, with their recipient. */
export function sentMagicLinks(mail: ReturnType<typeof mockMail>) {
    return mail.mock.calls.map(([to, url]) => ({ to, token: new URL(url).searchParams.get('token')! }));
}

let counter = 0;

/** Creates a user with `role` (staff get `STAFF_PASSWORD`, clients none) and returns it with a valid Bearer header. */
export async function createUserWithToken(role: Role) {
    counter += 1;
    const user = await createUser({
        email: `${role.toLowerCase()}${counter}@test.local`,
        name: role,
        lastName: null,
        password: signsInWithMagicLink(role) ? null : STAFF_PASSWORD,
        role,
    });

    // New users start at tokenVersion 0 (schema default).
    const token = signAccessToken({ id: user.id, role: user.role, tokenVersion: 0 });

    return { user, auth: `Bearer ${token}` };
}

/** A valid `POST /api/events` body (Ana & Luis, 14 Mar 2027 16:00–03:00 Mexico City). */
export const eventBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Ana & Luis',
    opensAt: '2027-03-14T16:00:00-06:00',
    closesAt: '2027-03-15T03:00:00-06:00',
    timezone: 'America/Mexico_City',
    venueName: 'Hacienda San Gabriel',
    ...overrides,
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * An ENABLED event owned by a new client. `open` puts `now` inside the upload window
 * (otherwise the window is in 2027); `geofence` centers it on Guadalajara with a 5 km radius.
 */
export async function createEnabledEvent({ packageMax = 100, open = true, geofence = false } = {}) {
    const owner = await createUserWithToken(ROLE.USER);
    const created = await createEvent(owner.user.id, {
        name: 'Ana & Luis',
        opensAt: open ? new Date(Date.now() - HOUR_MS) : new Date('2027-03-14T22:00:00Z'),
        closesAt: open ? new Date(Date.now() + 5 * HOUR_MS) : new Date('2027-03-15T09:00:00Z'),
        timezone: 'America/Mexico_City',
        venueName: 'Hacienda San Gabriel',
        geofenceEnabled: geofence,
        latitude: geofence ? 20.6597 : null,
        longitude: geofence ? -103.3496 : null,
        radiusMeters: RADIUS_METERS.MAX,
        moderationRequired: true,
        galleryPollSeconds: 120,
    });
    const event = (await db.orm.public.Event.where({ id: created.id }).update({ status: EVENT_STATUS.ENABLED, packageMax, enabledAt: new Date() }))!;
    return { owner, event };
}

let mediaCounter = 0;

/** A media row straight in the database (no file in storage; galleries only sign URLs). */
export async function addMedia(
    eventId: string,
    guestId: string,
    { status, kind = MEDIA_KIND.PHOTO, at = new Date() }: { status: MediaStatus; kind?: MediaKind; at?: Date },
) {
    mediaCounter += 1;
    return db.orm.public.Media.create({
        eventId,
        guestId,
        kind,
        status,
        storageKey: `events/${eventId}/seed-${mediaCounter}.jpg`,
        mimeType: kind === MEDIA_KIND.PHOTO ? 'image/jpeg' : 'video/mp4',
        sizeBytes: 1000,
        createdAt: at,
        uploadedAt: status === MEDIA_STATUS.UPLOADING ? null : at,
        publishedAt: status === MEDIA_STATUS.PUBLISHED ? at : null,
        moderatedById: null,
    });
}
