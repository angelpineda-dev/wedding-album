import type { ReqUser } from "./user.ts";
import type { ReqGuest } from "./guest.ts";

declare global {
    namespace Express {
        interface Request {
            user?: ReqUser;
            guest?: ReqGuest;
        }
    }
}
