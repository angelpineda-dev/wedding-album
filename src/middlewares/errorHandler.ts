import type { NextFunction, Request, Response } from "express";
import { ZodError, z } from "zod";
import AppError from "../errors/AppError.ts";
import { authMessages } from "../core/userMessages/auth.ts";

/** Errors from Express/body-parser (e.g. 400 malformed JSON, 413 body too large) mark client-safe messages with `expose`. */
const isExposedHttpError = (err: unknown): err is { status: number; message: string } =>
    typeof err === 'object' && err !== null && 'expose' in err && err.expose === true &&
    'status' in err && typeof err.status === 'number';

export const errorHandler = (
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction
) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
    }

    if (err instanceof ZodError) {
        return res.status(400).json({
            success: false,
            error: authMessages.INVALID_REQUEST,
            details: z.flattenError(err).fieldErrors,
        });
    }

    if (isExposedHttpError(err)) {
        return res.status(err.status).json({ success: false, error: err.message });
    }

    // Unknown error: log it, never leak internals to the client.
    console.error(err);

    return res.status(500).json({ success: false, error: authMessages.INTERNAL_ERROR });
}
