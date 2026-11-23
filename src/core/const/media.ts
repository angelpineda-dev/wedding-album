import { db } from '../../prisma/db.ts';

// Single source: the enums generated from src/prisma/contract.prisma.
export const MEDIA_KIND = db.enums.public.MediaKind.members;
export type MediaKind = (typeof MEDIA_KIND)[keyof typeof MEDIA_KIND];

export const MEDIA_STATUS = db.enums.public.MediaStatus.members;
export type MediaStatus = (typeof MEDIA_STATUS)[keyof typeof MEDIA_STATUS];

const MB = 1024 * 1024;

/** Accepted file types per kind, with the extension used in the storage key. */
export const ALLOWED_TYPES: Record<MediaKind, Record<string, string>> = {
    [MEDIA_KIND.PHOTO]: {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
    },
    [MEDIA_KIND.VIDEO]: {
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'video/webm': 'webm',
    },
};

export const MAX_SIZE_BYTES: Record<MediaKind, number> = {
    [MEDIA_KIND.PHOTO]: 25 * MB,
    [MEDIA_KIND.VIDEO]: 200 * MB,
};

/** Upload URLs a guest may hold open at once (issued but not completed). */
export const MAX_OPEN_UPLOADS = 10;

/** Page sizes for gallery and moderation lists. */
export const PAGE_SIZE = { DEFAULT: 30, MAX: 100 } as const;
