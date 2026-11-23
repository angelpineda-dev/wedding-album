import {
    CreateBucketCommand,
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
    S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.ts';

const s3 = new S3Client({
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    ...(env.S3_ENDPOINT && { endpoint: env.S3_ENDPOINT }),
});

/**
 * A URL the guest's device PUTs the file to directly. Content-Type and Content-Length are
 * signed, so the storage rejects a different type or size; `completeUpload` checks again.
 */
export async function createUploadUrl(key: string, mimeType: string, sizeBytes: number) {
    const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: mimeType, ContentLength: sizeBytes }),
        { expiresIn: env.UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
    );

    return {
        url,
        method: 'PUT' as const,
        headers: { 'Content-Type': mimeType },
        expiresAt: new Date(Date.now() + env.UPLOAD_URL_TTL_SECONDS * 1000),
    };
}

/** A short-lived URL to view or download a stored file. */
export function createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
        expiresIn: env.DOWNLOAD_URL_TTL_SECONDS,
    });
}

/** Size and type of a stored file, or null if nothing was uploaded under `key`. */
export async function headObject(key: string): Promise<{ sizeBytes: number; mimeType: string | undefined } | null> {
    try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
        return { sizeBytes: head.ContentLength ?? 0, mimeType: head.ContentType };
    } catch (error) {
        if (error instanceof NotFound || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)) {
            return null;
        }
        throw error;
    }
}

export async function deleteObject(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}

/** Creates the bucket if it does not exist (local MinIO and tests; production buckets are provisioned). */
export async function ensureBucket(): Promise<void> {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
            await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
            return;
        }
        throw error;
    }
}
