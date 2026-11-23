/** Database used by `npm test`. Defaults to the `wedding_album_test` DB created by docker-compose. */
export const TEST_DATABASE_URL =
    process.env['TEST_DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5433/wedding_album_test';

/** Tests truncate tables: refuse to run against anything that is not clearly a test database. */
export function assertTestDatabase(url: string): void {
    const dbName = new URL(url).pathname.slice(1);
    if (!dbName.endsWith('_test')) {
        throw new Error(`Refusing to run tests against "${dbName}": the database name must end with "_test".`);
    }
}
