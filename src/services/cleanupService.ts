import { and, or } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { env } from '../config/env.ts';
import { MEDIA_STATUS } from '../core/const/media.ts';
import { deleteObject } from './storageService.ts';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Unfinished uploads older than this are abandoned: their upload URL expired long ago. */
const STALE_UPLOAD_MINUTES = 60;
/** Expired or used sign-in links are kept this long for support questions, then removed. */
const MAGIC_LINK_RETENTION_DAYS = 1;
/**
 * Sessions are removed only after they expire: a revoked but unexpired one must stay so that
 * reusing its refresh token is still detected as theft.
 */
const SESSION_RETENTION_DAYS = 1;

export interface CleanupResult {
    staleUploads: number;
    magicLinks: number;
    sessions: number;
}

/**
 * Housekeeping, safe to run at any time and from several instances:
 * - abandoned uploads (UPLOADING, older than the upload URL's life): file and record removed;
 * - spent or expired magic links; expired sessions.
 */
export async function runCleanup(now = new Date()): Promise<CleanupResult> {
    const staleBefore = new Date(now.getTime() - Math.max(STALE_UPLOAD_MINUTES * MINUTE_MS, env.UPLOAD_URL_TTL_SECONDS * 1000));

    const stale = await db.orm.public.Media
        .where((m) => and(m.status.eq(MEDIA_STATUS.UPLOADING), m.createdAt.lt(staleBefore)))
        .select('id', 'storageKey')
        .all();

    let staleUploads = 0;
    for (const media of stale) {
        // A file may have been PUT without `complete` being called; delete is a no-op if not.
        await deleteObject(media.storageKey);
        const removed = await db.orm.public.Media
            .where((m) => and(m.id.eq(media.id), m.status.eq(MEDIA_STATUS.UPLOADING)))
            .deleteAndCount();
        staleUploads += removed;
    }

    const linkCutoff = new Date(now.getTime() - MAGIC_LINK_RETENTION_DAYS * DAY_MS);
    const magicLinks = await db.orm.public.MagicLink
        .where((l) => or(l.expiresAt.lt(linkCutoff), l.usedAt.lt(linkCutoff)))
        .deleteAndCount();

    const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY_MS);
    const sessions = await db.orm.public.Session
        .where((s) => s.expiresAt.lt(sessionCutoff))
        .deleteAndCount();

    return { staleUploads, magicLinks, sessions };
}
