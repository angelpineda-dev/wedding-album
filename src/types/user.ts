import type { Role } from '../core/const/roles.ts';

/** Authenticated user attached to `req.user` by the `authenticate` middleware. */
export interface ReqUser {
    id: number;
    role: Role;
}
