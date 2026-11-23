import { execFileSync } from 'node:child_process';
import { assertTestDatabase, TEST_DATABASE_URL } from './testEnv.ts';

/** Brings the test database to the latest migration once per `vitest` run. */
export default function setup() {
    assertTestDatabase(TEST_DATABASE_URL);

    try {
        execFileSync('npx', ['prisma', 'db', 'migrate', '--db', TEST_DATABASE_URL, '--yes', '--quiet'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const output = (error as { stdout?: Buffer; stderr?: Buffer });
        throw new Error(
            `Could not migrate the test database (is it running? try \`npm run db:up\`).\n${output.stdout ?? ''}${output.stderr ?? ''}`,
        );
    }
}
