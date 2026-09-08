import { MIDDLEWARE_OVERRIDE_HEADERS, MIDDLEWARE_REQUEST_HEADER_PREFIX } from "./protocol-headers.js";
//#region src/utils/middleware-request-headers.ts
function getMiddlewareHeaderValue(source, key) {
	if (source instanceof Headers) return source.get(key);
	const value = source[key];
	if (value === void 0) return null;
	return Array.isArray(value) ? value[0] ?? null : value;
}
function parseOverrideHeaderNames(rawValue) {
	return rawValue.split(",").map((key) => key.trim()).filter(Boolean);
}
function getForwardedRequestHeaders(source) {
	const forwardedHeaders = /* @__PURE__ */ new Map();
	if (source instanceof Headers) {
		for (const [key, value] of source.entries()) if (key.startsWith("x-middleware-request-")) forwardedHeaders.set(key.slice(MIDDLEWARE_REQUEST_HEADER_PREFIX.length), value);
		return forwardedHeaders;
	}
	for (const [key, value] of Object.entries(source)) {
		if (!key.startsWith("x-middleware-request-")) continue;
		const normalizedValue = Array.isArray(value) ? value[0] ?? "" : value;
		forwardedHeaders.set(key.slice(MIDDLEWARE_REQUEST_HEADER_PREFIX.length), normalizedValue);
	}
	return forwardedHeaders;
}
/**
* Return truthy forwarded values that Next.js does not consume through the
* override list. Its subsequent generic middleware-header merge exposes these
* under their literal protocol-header names on both the request and response.
*/
function getUnconsumedMiddlewareRequestHeaders(source) {
	const rawOverrideHeader = getMiddlewareHeaderValue(source, MIDDLEWARE_OVERRIDE_HEADERS);
	const overriddenHeaders = rawOverrideHeader ? new Set(parseOverrideHeaderNames(rawOverrideHeader)) : null;
	const unconsumedHeaders = /* @__PURE__ */ new Map();
	for (const [key, value] of getForwardedRequestHeaders(source)) if (value && !overriddenHeaders?.has(key)) unconsumedHeaders.set(`${MIDDLEWARE_REQUEST_HEADER_PREFIX}${key}`, value);
	return unconsumedHeaders;
}
function encodeMiddlewareRequestHeaders(targetHeaders, requestHeaders) {
	const overrideHeaderNames = [...requestHeaders.keys()];
	targetHeaders.set(MIDDLEWARE_OVERRIDE_HEADERS, overrideHeaderNames.join(","));
	for (const [key, value] of requestHeaders.entries()) targetHeaders.set(`${MIDDLEWARE_REQUEST_HEADER_PREFIX}${key}`, value);
}
/**
* A non-empty `x-middleware-override-headers` value lists the complete
* post-middleware header set, so any name absent from it was deleted by
* middleware. Never re-add absent headers from the base request — that would
* resurrect credentials the app explicitly stripped before an external
* rewrite. Next.js treats the empty value emitted for `new Headers()` as no
* override. Any unconsumed `x-middleware-request-*` values are subsequently
* copied to the request under their literal protocol-header names.
*/
function buildRequestHeadersFromMiddlewareResponse(baseHeaders, middlewareHeaders) {
	const forwardedHeaders = getForwardedRequestHeaders(middlewareHeaders);
	const unconsumedHeaders = getUnconsumedMiddlewareRequestHeaders(middlewareHeaders);
	const rawOverrideHeader = getMiddlewareHeaderValue(middlewareHeaders, MIDDLEWARE_OVERRIDE_HEADERS);
	if (!rawOverrideHeader) {
		if (unconsumedHeaders.size === 0) return null;
		const nextHeaders = new Headers(baseHeaders);
		for (const [key, value] of unconsumedHeaders) nextHeaders.set(key, value);
		return nextHeaders;
	}
	const overrideHeaderNames = parseOverrideHeaderNames(rawOverrideHeader);
	const nextHeaders = new Headers();
	for (const key of overrideHeaderNames) {
		const value = forwardedHeaders.get(key);
		if (value !== void 0) nextHeaders.set(key, value);
	}
	for (const [key, value] of unconsumedHeaders) nextHeaders.set(key, value);
	return nextHeaders;
}
function shouldKeepMiddlewareHeader(key) {
	return key === "x-middleware-override-headers" || key === "x-middleware-cache" || key === "x-middleware-set-cookie" || key.startsWith("x-middleware-request-");
}
//#endregion
export { buildRequestHeadersFromMiddlewareResponse, encodeMiddlewareRequestHeaders, getUnconsumedMiddlewareRequestHeaders, shouldKeepMiddlewareHeader };
