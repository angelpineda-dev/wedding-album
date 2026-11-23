import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './test/testEnv.ts';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        globalSetup: ['test/globalSetup.ts'],
        // Every file shares one database and truncates it: run files one at a time.
        fileParallelism: false,
        // Each test starts with fresh spies (e.g. the mail mock).
        restoreMocks: true,
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: TEST_DATABASE_URL,
            JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
            BCRYPT_COST: '10',
            AUTH_RATE_LIMIT_MAX: '1000',
            CORS_ORIGINS: 'http://localhost:5173',
        },
    },
});
