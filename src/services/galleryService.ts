import { and, or } from '@prisma/orm-postgres/orm-client';
import { db } from '../prisma/db.ts';
import { MEDIA_STATUS, type MediaKind } from '../core/const/media.ts';
import { encodeCursor, type Cursor } from '../utils/cursor.ts';
import { createDownloadUrl } from './storageService.ts';

export interface GalleryQuery {
    /** Older page: items published before this cursor. */
    before?: Cursor;
    /** Polling: items published after this cursor (the `latestCursor` of the previous answer). */
    since?: Cursor;
    kind?: MediaKind;
    limit: number;
}

type MediaRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Media.first>>>;
// The ORM types a to-one include as nullable even when the FK is required.
type MediaWithGuest = MediaRow & { guest: { name: string } | null };

const cursorOf = (item: MediaRow): Cursor => ({ at: item.publishedAt!, id: item.id });

/** A media item as galleries show it, with a short-lived URL to the file. */
export const toGalleryItem = async (item: MediaWithGuest) => ({
    id: item.id,
    kind: item.kind,
    mimeType: item.mimeType,
    guestName: item.guest?.name ?? null,
    publishedAt: item.publishedAt,
    url: await createDownloadUrl(item.storageKey),
});

/**
 * The published media of an event, newest first, by keyset on (publishedAt, id).
 * - First load: no cursor. Older pages: `before = nextCursor`.
 * - Polling every `galleryPollSeconds`: `since = latestCursor` returns only what is new.
 * Items hidden after being published simply stop appearing; a client refreshes fully to drop them.
 */
export async function listGallery(eventId: string, query: GalleryQuery) {
    const media = db.orm.public.Media;
    const base = media.where((m) => and(
        m.eventId.eq(eventId),
        m.status.eq(MEDIA_STATUS.PUBLISHED),
        ...(query.kind === undefined ? [] : [m.kind.eq(query.kind)]),
    ));

    const { since, before } = query;
    const page = since
        ? base
            .where((m) => or(m.publishedAt.gt(since.at), and(m.publishedAt.eq(since.at), m.id.gt(since.id))))
            .orderBy([(m) => m.publishedAt.asc(), (m) => m.id.asc()])
        : (before
            ? base.where((m) => or(m.publishedAt.lt(before.at), and(m.publishedAt.eq(before.at), m.id.lt(before.id))))
            : base
        ).orderBy([(m) => m.publishedAt.desc(), (m) => m.id.desc()]);

    const rows = await page.include('guest', (guest) => guest.select('name')).limit(query.limit).all();

    // Polling reads oldest-first so a capped page never skips items; answer newest-first either way.
    const items = since ? [...rows].reverse() : rows;
    const newest = items[0];
    const oldest = items.at(-1);

    return {
        items: await Promise.all(items.map(toGalleryItem)),
        // More older items may exist only when a full page came back (not meaningful while polling).
        nextCursor: !since && oldest && rows.length === query.limit ? encodeCursor(cursorOf(oldest)) : null,
        // Hand back on the next poll; unchanged when nothing new arrived.
        latestCursor: newest ? encodeCursor(cursorOf(newest)) : (since ? encodeCursor(since) : null),
    };
}
