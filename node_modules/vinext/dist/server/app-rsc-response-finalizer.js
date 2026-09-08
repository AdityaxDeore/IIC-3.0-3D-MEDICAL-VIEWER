import { hasBasePath, stripBasePath } from "../utils/base-path.js";
import "./headers.js";
import { sanitizeMethodNotAllowedHeaders } from "./http-error-responses.js";
import { normalizeDefaultLocalePathname } from "./pages-i18n.js";
import { applyCdnResponseHeaders } from "./cache-control.js";
import { VINEXT_RSC_VARY_HEADER } from "./app-rsc-cache-busting.js";
import { mergeVaryHeader } from "./middleware-response-headers.js";
//#region src/server/app-rsc-response-finalizer.ts
const HAS_CONFIG_HEADERS = process.env.__VINEXT_HAS_CONFIG_HEADERS !== "false";
const configHeadersAlreadyApplied = /* @__PURE__ */ new WeakSet();
/** Mark a response whose final target pipeline has already applied config headers. */
function markAppRscResponseConfigHeadersApplied(response) {
	configHeadersAlreadyApplied.add(response);
	return response;
}
/** Apply only the matching next.config headers for an App Router request. */
async function applyAppRscConfigHeaders(headers, request, options) {
	if (!HAS_CONFIG_HEADERS || !options.configHeaders.length) return;
	const url = new URL(request.url);
	let pathname = url.pathname;
	const hadBasePath = !options.basePath || hasBasePath(pathname, options.basePath);
	pathname = stripBasePath(pathname, options.basePath);
	const matchPathname = options.i18nConfig ? normalizeDefaultLocalePathname(pathname, options.i18nConfig, { hostname: url.hostname }) : pathname;
	const { applyConfigHeadersToResponse } = await import("./config-headers.js");
	applyConfigHeadersToResponse(headers, {
		configHeaders: options.configHeaders,
		pathname: matchPathname,
		requestContext: options.requestContext,
		basePathState: {
			basePath: options.basePath,
			hadBasePath
		}
	});
}
/**
* Apply App Router response finalization that must happen outside individual
* route dispatchers.
*
* Called once per request in the outer handler() wrapper, after all route
* handling, so that every response path (page, route handler, server action,
* metadata, not-found) gets headers applied consistently.
*
* Skips 3xx redirect responses. Response.redirect() creates immutable
* headers that throw on mutation, and Next.js does not apply config headers
* to redirects regardless.
*/
async function finalizeAppRscResponse(response, request, options) {
	if (response.status >= 300 && response.status < 400) return response;
	if (!response.headers.has("x-vinext-static-file")) {
		const varyHeader = response.headers.get("Vary");
		if (varyHeader === null) response.headers.set("Vary", VINEXT_RSC_VARY_HEADER);
		else if (varyHeader !== VINEXT_RSC_VARY_HEADER) mergeVaryHeader(response.headers, VINEXT_RSC_VARY_HEADER);
	}
	if (!response.headers.has("Cache-Control")) applyCdnResponseHeaders(response.headers, { cacheControl: "" });
	if (configHeadersAlreadyApplied.has(response)) return response;
	await applyAppRscConfigHeaders(response.headers, request, options);
	if (response.status === 405 && response.headers.get("Allow") === "GET, HEAD") sanitizeMethodNotAllowedHeaders(response.headers, "GET, HEAD");
	return response;
}
//#endregion
export { applyAppRscConfigHeaders, finalizeAppRscResponse, markAppRscResponseConfigHeadersApplied };
