/** One cleanup pass, for an external cron: `npm run cleanup`. */
import { db } from '../src/prisma/db.ts';
import { runCleanup } from '../src/services/cleanupService.ts';

try {
    console.log(await runCleanup());
} finally {
    await db.close();
}
