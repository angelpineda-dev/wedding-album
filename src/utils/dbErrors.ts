const UNIQUE_VIOLATION = '23505';

/** Postgres driver errors carry the SQLSTATE in `sqlState` (Prisma's SqlQueryError is not exported). */
export const isUniqueViolation = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'sqlState' in error && error.sqlState === UNIQUE_VIOLATION;
