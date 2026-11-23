import { db } from '../src/prisma/db.ts';
import { createUser } from '../src/services/authService.ts';
import { signAccessToken } from '../src/services/tokenService.ts';
import type { Role } from '../src/core/const/roles.ts';
import { assertTestDatabase } from './testEnv.ts';

export async function resetDatabase(): Promise<void> {
    assertTestDatabase(process.env['DATABASE_URL']!);
    await db.execute(db.raw.sql`TRUNCATE TABLE sessions, users RESTART IDENTITY CASCADE`.affectedCount().build());
}

let counter = 0;

/** Creates a user with `role` and returns it with a valid Bearer header. */
export async function createUserWithToken(role: Role) {
    counter += 1;
    const user = await createUser({
        email: `${role.toLowerCase()}${counter}@test.local`,
        name: role,
        lastName: null,
        password: 'correct-horse-battery',
        role,
    });

    // New users start at tokenVersion 0 (schema default).
    const token = signAccessToken({ id: user.id, role: user.role, tokenVersion: 0 });

    return { user, auth: `Bearer ${token}` };
}
