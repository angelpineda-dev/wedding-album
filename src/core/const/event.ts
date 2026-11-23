import { db } from '../../prisma/db.ts';

// Single source: the enums generated from src/prisma/contract.prisma.
export const EVENT_STATUS = db.enums.public.EventStatus.members;
export type EventStatus = (typeof EVENT_STATUS)[keyof typeof EVENT_STATUS];

export const EVENT_TYPE = db.enums.public.EventType.members;
export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

/** Packages are sold in steps of this many guests. */
export const PACKAGE_STEP = 25;
export const PACKAGE_MAX = 1000;
/** Extra guests allowed on top of the paid package. */
export const GUEST_TOLERANCE = 5;

export const GALLERY_POLL_SECONDS = { MIN: 15, MAX: 600 } as const;
export const RADIUS_METERS = { MIN: 100, MAX: 50_000 } as const;
/** Longest allowed upload window. */
export const MAX_WINDOW_HOURS = 72;

/** Where `now` falls relative to an event's upload window (computed, not stored). */
export const UPLOAD_WINDOW = {
    UPCOMING: 'UPCOMING',
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
} as const;
export type UploadWindow = (typeof UPLOAD_WINDOW)[keyof typeof UPLOAD_WINDOW];

/** A guest token stays valid this long after the event closes (to keep browsing "my uploads"). */
export const GUEST_TOKEN_GRACE_DAYS = 7;
