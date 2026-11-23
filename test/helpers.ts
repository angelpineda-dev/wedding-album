import { vi } from 'vitest';
import { db } from '../src/prisma/db.ts';
import { createUser, signsInWithMagicLink } from '../src/services/authService.ts';
import { signAccessToken } from '../src/services/tokenService.ts';
import { mailService } from '../src/services/mailService.ts';
import type { Role } from '../src/core/const/roles.ts';
import { assertTestDatabase } from './testEnv.ts';

export const STAFF_PASSWORD = 'correct-horse-battery';

export async function resetDatabase(): Promise<void> {
    assertTestDatabase(process.env['DATABASE_URL']!);
    await db.execute(db.raw.sql`TRUNCATE TABLE events, magic_links, sessions, users RESTART IDENTITY CASCADE`.affectedCount().build());
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
