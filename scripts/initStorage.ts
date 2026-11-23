/** Creates the media bucket if missing (local MinIO). `npm run storage:init` */
import { env } from '../src/config/env.ts';
import { ensureBucket } from '../src/services/storageService.ts';

await ensureBucket();
console.log(`Bucket "${env.S3_BUCKET}" is ready.`);
