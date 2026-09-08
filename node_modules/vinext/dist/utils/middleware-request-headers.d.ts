//#region src/utils/middleware-request-headers.d.ts
type MiddlewareHeaderValue = string | string[];
type MiddlewareHeaderSource = Headers | Record<string, MiddlewareHeaderValue>;
/**
 * Return truthy forwarded values that Next.js does not consume through the
 * override list. Its subsequent generic middleware-header merge exposes these
 * under their literal protocol-header names on both the request and response.
 */
declare function getUnconsumedMiddlewareRequestHeaders(source: MiddlewareHeaderSource): Map<string, string>;
declare function encodeMiddlewareRequestHeaders(targetHeaders: Headers, requestHeaders: Headers): void;
/**
 * A non-empty `x-middleware-override-headers` value lists the complete
 * post-middleware header set, so any name absent from it was deleted by
 * middleware. Never re-add absent headers from the base request — that would
 * resurrect credentials the app explicitly stripped before an external
 * rewrite. Next.js treats the empty value emitted for `new Headers()` as no
 * override. Any unconsumed `x-middleware-request-*` values are subsequently
 * copied to the request under their literal protocol-header names.
 */
declare function buildRequestHeadersFromMiddlewareResponse(baseHeaders: Headers, middlewareHeaders: MiddlewareHeaderSource): Headers | null;
declare function shouldKeepMiddlewareHeader(key: string): boolean;
//#endregion
export { buildRequestHeadersFromMiddlewareResponse, encodeMiddlewareRequestHeaders, getUnconsumedMiddlewareRequestHeaders, shouldKeepMiddlewareHeader };