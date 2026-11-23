/**
 * Creates the first SUPER_ADMIN (nobody can register without a session).
 * Idempotent: if a SUPER_ADMIN with that email exists, it does nothing.
 *
 *   SUPERADMIN_EMAIL=me@example.com SUPERADMIN_NAME=Me SUPERADMIN_PASSWORD=... npm run seed:superadmin
 *   npm run seed:superadmin -- --email me@example.com --name Me [--last-name Doe]
 *
 * Prefer the env var for the password: `--password` stays in your shell history.
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { db } from '../src/prisma/db.ts';
import { ROLE } from '../src/core/const/roles.ts';
import { createUser } from '../src/services/authService.ts';

const { values: args } = parseArgs({
    options: {
        email: { type: 'string' },
        name: { type: 'string' },
        'last-name': { type: 'string' },
        password: { type: 'string' },
    },
});

const inputSchema = z.object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100).optional(),
    password: z.string().min(12, 'must be at least 12 characters').max(128),
});

const parsed = inputSchema.safeParse({
    email: args.email ?? process.env['SUPERADMIN_EMAIL'],
    name: args.name ?? process.env['SUPERADMIN_NAME'],
    lastName: args['last-name'] ?? process.env['SUPERADMIN_LAST_NAME'],
    password: args.password ?? process.env['SUPERADMIN_PASSWORD'],
});

try {
    if (!parsed.success) {
        console.error(`Invalid input:\n${z.prettifyError(parsed.error)}`);
        process.exitCode = 1;
    } else {
        const input = parsed.data;
        const existing = await db.orm.public.User.select('id', 'role').where({ email: input.email }).first();

        if (existing?.role === ROLE.SUPER_ADMIN) {
            console.log(`SUPER_ADMIN ${input.email} already exists (id ${existing.id}); nothing to do.`);
        } else if (existing) {
            // Never promote silently: an existing account with another role needs a deliberate decision.
            console.error(`${input.email} already exists with role ${existing.role}; not changing it.`);
            process.exitCode = 1;
        } else {
            const user = await createUser({ ...input, lastName: input.lastName ?? null, role: ROLE.SUPER_ADMIN });
            console.log(`Created SUPER_ADMIN ${user.email} (id ${user.id}).`);
        }
    }
} finally {
    await db.close();
}
