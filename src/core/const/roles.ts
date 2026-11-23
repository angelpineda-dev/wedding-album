import { db } from '../../prisma/db.ts';

// Single source: the `Role` enum generated from src/prisma/contract.prisma.
export const ROLE = db.enums.public.Role.members;

export type Role = (typeof ROLE)[keyof typeof ROLE];
