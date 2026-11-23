import 'dotenv/config';
import { z } from 'zod';

export const NodeEnv = z.enum(['development', 'production', 'test']);

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');
const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
    NODE_ENV: NodeEnv.default(NodeEnv.enum.development),
    PORT: positiveInt.default(3000),
    DATABASE_URL: z.url(),

    // Access token (JWT)
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('login-api'),
    JWT_AUDIENCE: z.string().min(1).default('login-client'),
    ACCESS_TOKEN_TTL_SECONDS: positiveInt.default(900),

    // Refresh token (opaque, stored hashed in `sessions`)
    REFRESH_TOKEN_TTL_DAYS: positiveInt.default(7),
    // Defaults to true in production.
    COOKIE_SECURE: booleanString.optional(),

    // Login hardening
    BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
    LOGIN_MAX_ATTEMPTS: positiveInt.default(5),
    LOGIN_LOCK_MINUTES: positiveInt.default(15),
    AUTH_RATE_LIMIT_WINDOW_MINUTES: positiveInt.default(15),
    AUTH_RATE_LIMIT_MAX: positiveInt.default(20),

    // Comma-separated browser origins allowed to call the API with credentials (refresh cookie).
    // Empty = no cross-origin access. Each entry must be a bare origin, e.g. https://app.example.com
    CORS_ORIGINS: z.string().default('')
        .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
        .pipe(z.array(z.url().refine((origin) => new URL(origin).origin === origin, 'must be a bare origin (scheme://host[:port])'))),

    // Number of reverse proxies in front of the app (0 = none). Needed for real client IPs.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
}

export const env = {
    ...parsed.data,
    COOKIE_SECURE: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === NodeEnv.enum.production,
};
