import type { db } from '../prisma/db.ts';

type EventRow = NonNullable<Awaited<ReturnType<typeof db.orm.public.Event.first>>>;

/** Guest attached to `req.guest` by the `authenticateGuest` middleware, with its (ENABLED) event. */
export interface ReqGuest {
    id: string;
    name: string;
    event: EventRow;
}
