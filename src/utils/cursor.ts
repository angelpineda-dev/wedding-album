import { z } from 'zod';

/**
 * Opaque keyset cursor: a timestamp plus the row id as tiebreaker, base64url-encoded.
 * Clients pass it back unchanged; they never build or read one.
 */
export interface Cursor {
    at: Date;
    id: string;
}

const payload = z.strictObject({ at: z.iso.datetime(), id: z.uuid() });

export const encodeCursor = ({ at, id }: Cursor): string =>
    Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');

/** Zod schema for a cursor query param; an invalid cursor is a 400 like any other bad input. */
export const cursorParam = z.string().max(200).transform((value, ctx): Cursor => {
    try {
        const parsed = payload.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
        return { at: new Date(parsed.at), id: parsed.id };
    } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid cursor.' });
        return z.NEVER;
    }
});
