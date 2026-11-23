import { env, NodeEnv } from '../config/env.ts';

/**
 * Outgoing email. No provider is wired yet: outside production the message is logged
 * so the magic link can be copied from the console; in production it is NOT logged
 * (the link is a credential) and a warning says that nothing was sent.
 */
export const mailService = {
    async sendMagicLink(to: string, url: string): Promise<void> {
        if (env.NODE_ENV === NodeEnv.enum.production) {
            console.warn(`[mail] No email provider configured: magic link for ${to} was not sent.`);
            return;
        }

        console.info(`[mail] Magic link for ${to}: ${url}`);
    },
};
