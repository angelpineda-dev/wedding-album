import { db } from '../../prisma/db.ts';

// Single source: the `UserStatus` enum generated from src/prisma/contract.prisma.
export const USER_STATUS = db.enums.public.UserStatus.members;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
