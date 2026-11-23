import type { Role } from '../core/const/roles.ts';

/** Validated data needed to create a user. The password is still in plain text. */
export interface NewUser {
    email: string;
    name: string;
    lastName: string | null;
    password: string;
    role: Role;
}
