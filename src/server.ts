import { env } from './config/env.ts';
import { app } from './app.ts';
import { runCleanup } from './services/cleanupService.ts';

app.listen(env.PORT, () => {
    console.log(`Server is running at http://localhost:${env.PORT}`);
});

if (env.CLEANUP_INTERVAL_MINUTES > 0) {
    const cleanup = () =>
        runCleanup()
            .then((result) => console.info('[cleanup]', result))
            .catch((error: unknown) => console.error('[cleanup] failed', error));

    // Does not keep the process alive on its own; a failed run is retried at the next tick.
    setInterval(cleanup, env.CLEANUP_INTERVAL_MINUTES * 60 * 1000).unref();
}
