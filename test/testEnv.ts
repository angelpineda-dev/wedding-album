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

/** MinIO from docker-compose; tests use their own bucket. */
export const TEST_S3 = {
    S3_ENDPOINT: process.env['TEST_S3_ENDPOINT'] ?? 'http://localhost:9000',
    S3_BUCKET: 'wedding-album-media-test',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    S3_FORCE_PATH_STYLE: 'true',
} as const;
