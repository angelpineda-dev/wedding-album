import { db } from '../prisma/db.ts';
import { MEDIA_STATUS } from '../core/const/media.ts';

/** Files that occupy storage: everything confirmed (pending, published or hidden), not unfinished uploads. */
const storedMedia = () => db.orm.public.Media.where((m) => m.status.neq(MEDIA_STATUS.UPLOADING));

export async function totalStorageBytes(): Promise<number> {
    const { bytes } = await storedMedia().aggregate((aggregate) => ({ bytes: aggregate.sum('sizeBytes') }));
    return bytes ?? 0;
}

/** Bytes stored per client (event owner). Clients with nothing stored are absent. */
export async function storageBytesByOwner(): Promise<Map<number, number>> {
    const [perEvent, events] = await Promise.all([
        storedMedia().groupBy('eventId').aggregate((aggregate) => ({ bytes: aggregate.sum('sizeBytes') })),
        db.orm.public.Event.select('id', 'ownerId').all(),
    ]);

    const ownerOf = new Map(events.map((event) => [event.id, event.ownerId]));
    const totals = new Map<number, number>();

    for (const { eventId, bytes } of perEvent) {
        const owner = ownerOf.get(eventId);
        if (owner !== undefined) {
            totals.set(owner, (totals.get(owner) ?? 0) + (bytes ?? 0));
        }
    }
    return totals;
}
