import { OnRequestErrorContext } from "./instrumentation.js";
import { RenderObservation } from "./cache-proof.js";
import { AppRscRenderMode } from "./app-rsc-render-mode.js";
import { PRERENDER_REVALIDATE_HEADER, PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER } from "../utils/protocol-headers.js";
import { normalizeMountedSlotsHeader } from "./app-mounted-slots-header.js";
import { CacheControlMetadata, CacheHandlerValue, CachedAppPageValue, CachedPagesValue, IncrementalCacheValue } from "../shims/cache-handler.js";
//#region src/server/isr-cache.d.ts
declare function getRevalidateSecret(): string;
declare function isRevalidateSecret(value: string | null | undefined): boolean;
/**
 * Authorize an incoming request as an on-demand revalidation trigger. Mirrors
 * Next.js's `checkIsOnDemandRevalidate`: the {@link PRERENDER_REVALIDATE_HEADER}
 * value must *equal* the process revalidate secret. Header presence alone is
 * NOT sufficient — see the security note on {@link PRERENDER_REVALIDATE_HEADER}.
 */
declare function isOnDemandRevalidateRequest(headerValue: string | string[] | null | undefined): boolean;
type ISRCacheEntry = {
  value: CacheHandlerValue;
  isStale: boolean;
  /** The entry crossed its hard expire boundary and must not be served. */
  isExpired?: boolean;
};
/**
 * Get a cache entry with staleness information.
 *
 * Returns { value, isStale: false } for fresh entries,
 * { value, isStale: true } for stale-but-usable entries,
 * { value, isStale: true, isExpired: true } for entries that must be retained
 * as regeneration input but not served, or null for cache misses.
 */
declare function isrGet(key: string): Promise<ISRCacheEntry | null>;
/**
 * Assemble cache-control metadata, omitting the dimensions the producing
 * render made no claim about. Shared by every ISR writer so `expire`/`stale`
 * are never invented from `revalidate`.
 */
declare function isrCacheControl(revalidateSeconds: number | false, claims?: {
  expireSeconds?: number;
  staleSeconds?: number;
}): CacheControlMetadata;
/**
 * Write policy for one ISR entry: the cache metadata the producing render
 * resolved, plus the tags that can invalidate it. Routers differ only in which
 * `cacheControl` dimensions they populate — App pages carry the client-router
 * `stale` bound, Pages Router and route handlers do not.
 */
type IsrWritePolicy = {
  cacheControl: CacheControlMetadata;
  tags?: string[];
};
/**
 * Store a value in the ISR cache under the given write policy.
 */
declare function isrSet(key: string, data: IncrementalCacheValue | null, policy: IsrWritePolicy): Promise<void>;
type AppPageCacheSetter = (key: string, data: CachedAppPageValue, policy: IsrWritePolicy) => Promise<void>;
declare function isrSetPrerenderedAppPage(key: string, data: CachedAppPageValue, metadata: {
  expireSeconds?: number;
  revalidateSeconds?: number;
  /** Client reuse bound from the prerender's `cacheLife`. */
  staleSeconds?: number;
  /**
   * Implicit/path tags to attach to the seeded entry. Required so that
   * `revalidatePath()` (and `revalidateTag()`) can invalidate prerender-seeded
   * cache entries — without tags the entry is unreachable by tag-based
   * invalidation and remains stale until natural `revalidateAt` expiry.
   * See cloudflare/vinext#1486.
   */
  tags?: string[];
}): Promise<void>;
/** Coalesce same-key synchronous on-demand revalidations. */
declare function coalesceOnDemandRevalidation<T>(key: string, renderFn: () => Promise<T>): Promise<T>;
/**
 * Trigger a background regeneration for a cache key.
 *
 * If a regeneration for this key is already in progress, this is a no-op.
 * The renderFn should produce the new cache value and call isrSet internally.
 *
 * On Cloudflare Workers the regeneration promise is registered with
 * `ctx.waitUntil()` via the ALS-backed ExecutionContext, keeping the isolate
 * alive until the regeneration completes even after the Response is returned.
 *
 * When `errorContext` is provided and the render function fails, the error
 * is reported via `reportRequestError` (instrumentation hook) with
 * `revalidateReason: "stale"`.
 */
declare function triggerBackgroundRegeneration(key: string, renderFn: () => Promise<void>, errorContext?: {
  routerKind: OnRequestErrorContext["routerKind"];
  routePath: string;
  routeType: OnRequestErrorContext["routeType"];
}): void;
/**
 * Build a CachedPagesValue for the Pages Router ISR cache.
 */
declare function buildPagesCacheValue(html: string, pageData: object, status?: number): CachedPagesValue;
/**
 * Build a CachedAppPageValue for the App Router ISR cache.
 */
declare function buildAppPageCacheValue(html: string, rscData?: ArrayBuffer, status?: number, renderObservation?: RenderObservation, headers?: CachedAppPageValue["headers"]): CachedAppPageValue;
/**
 * Compute an ISR cache key for a given router type and pathname.
 * Long pathnames are hashed to stay within KV key-length limits (512 bytes).
 */
declare function isrCacheKey(router: string, pathname: string, buildId?: string): string;
/**
 * Compute an App Router ISR key for one cache artifact.
 *
 * App pages store HTML, RSC payloads, and route-handler responses separately.
 * The suffix mirrors Next.js's separate on-disk app artifacts while keeping the
 * Cloudflare KV key under its 512-byte limit for long pathnames.
 */
declare function appIsrCacheKey(pathname: string, suffix: string, buildId?: string | undefined): string;
declare function appIsrHtmlKey(pathname: string): string;
/**
 * Build the ISR cache key for an RSC payload.
 *
 * Variants are sequenced in order: `source:<hash>` (intercepted source context,
 * only when an interception context is present), `slots:<hash>` (mounted parallel
 * route slots), and optionally `<render-mode-variant>` (for example,
 * `prefetch-loading-shell`). Existing cached entries under the old format will
 * become unreachable after deployment. This is acceptable because ISR entries
 * have TTLs and will be regenerated on the next request.
 */
declare function appIsrRscKey(pathname: string, mountedSlotsHeader?: string | null, renderMode?: AppRscRenderMode, interceptionContext?: string | null): string;
declare function appIsrRouteKey(pathname: string): string;
/**
 * Store the revalidate duration for a cache key.
 * Uses insertion-order LRU eviction to prevent unbounded growth.
 */
declare function setRevalidateDuration(key: string, seconds: number): void;
/**
 * Get the revalidate duration for a cache key.
 */
declare function getRevalidateDuration(key: string): number | undefined;
//#endregion
export { AppPageCacheSetter, ISRCacheEntry, IsrWritePolicy, PRERENDER_REVALIDATE_HEADER, PRERENDER_REVALIDATE_ONLY_GENERATED_HEADER, appIsrCacheKey, appIsrHtmlKey, appIsrRouteKey, appIsrRscKey, buildAppPageCacheValue, buildPagesCacheValue, coalesceOnDemandRevalidation, getRevalidateDuration, getRevalidateSecret, isOnDemandRevalidateRequest, isRevalidateSecret, isrCacheControl, isrCacheKey, isrGet, isrSet, isrSetPrerenderedAppPage, normalizeMountedSlotsHeader, setRevalidateDuration, triggerBackgroundRegeneration };