import { execFileSync } from 'node:child_process';
import { CreateBucketCommand, HeadBucketCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';
import { assertTestDatabase, TEST_DATABASE_URL, TEST_S3 } from './testEnv.ts';

/** Creates the test bucket in MinIO. (The app's env is not loaded here, so it uses TEST_S3 directly.) */
async function ensureTestBucket() {
    const s3 = new S3Client({
        endpoint: TEST_S3.S3_ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: TEST_S3.S3_ACCESS_KEY_ID, secretAccessKey: TEST_S3.S3_SECRET_ACCESS_KEY },
    });

    try {
        await s3.send(new HeadBucketCommand({ Bucket: TEST_S3.S3_BUCKET }));
    } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
            await s3.send(new CreateBucketCommand({ Bucket: TEST_S3.S3_BUCKET }));
            return;
        }
        throw new Error(`Could not reach MinIO at ${TEST_S3.S3_ENDPOINT} (try \`npm run db:up\`): ${String(error)}`);
    }
}

/** Brings the test database to the latest migration and the test bucket into existence, once per run. */
export default async function setup() {
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

    await ensureTestBucket();
}
