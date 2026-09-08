import { VinextLinkPrefetchRoute } from "../../client/vinext-next-data.js";
//#region src/shims/internal/app-route-prefetch-policy.d.ts
declare global {
  interface Window {
    __VINEXT_LINK_PREFETCH_ROUTES__?: VinextLinkPrefetchRoute[];
  }
}
/**
 * How an App Router prefetch for a given href should behave: whether to issue
 * it at all, whether the response is reusable by a later navigation, and which
 * cache TTL family applies.
 */
type AppRoutePrefetchPolicy = {
  cacheForNavigation: boolean;
  fallbackTtl: "dynamic" | "static";
  /**
   * Whether a dynamic render's stale-time bound applies verbatim, including
   * below the 30s prefetch floor. Automatic prefetches take it verbatim, so a
   * dynamic `0` is never reused. `prefetch={true}` opts into caching dynamic
   * content and keeps the floored static window, mirroring Next's split
   * between `auto` and `full` in `getPrefetchEntryCacheStatus`.
   */
  honorDynamicStaleTime: boolean;
  prefetchShellFirst: boolean;
  shouldPrefetch: boolean;
};
declare function canAutoPrefetchFullAppRoute(href: string): boolean;
declare function resolveAutoAppRoutePrefetch(href: string): AppRoutePrefetchPolicy;
declare function resolveFullAppRoutePrefetch(): AppRoutePrefetchPolicy;
//#endregion
export { AppRoutePrefetchPolicy, canAutoPrefetchFullAppRoute, resolveAutoAppRoutePrefetch, resolveFullAppRoutePrefetch };