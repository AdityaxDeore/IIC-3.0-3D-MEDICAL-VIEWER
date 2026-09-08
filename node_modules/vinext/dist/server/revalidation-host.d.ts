import { NextI18nConfig } from "../config/next-config.js";
//#region src/server/revalidation-host.d.ts
/**
 * Read the logical request hostname carried by a server-pinned revalidation
 * loopback. The side channel is accepted only as part of the authenticated
 * revalidation protocol and only for an exact configured i18n domain.
 */
declare function readTrustedRevalidationHostname(headers: Headers, i18nConfig: NextI18nConfig | null | undefined, authorizeRevalidation?: (headerValue: string | null) => boolean): string | null;
//#endregion
export { readTrustedRevalidationHostname };