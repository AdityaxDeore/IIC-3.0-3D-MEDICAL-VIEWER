import "./server-globals.js";
import { getRequestExecutionContext, runWithExecutionContext } from "../shims/request-context.js";
import { NextRequest } from "../shims/server.js";
import { internalServerErrorResponse } from "./http-error-responses.js";
import { cloneRequestWithUrl } from "./request-pipeline.js";
import { mergeRouteParamsIntoQuery, parseQueryString, urlQueryToSearchParams } from "../utils/query.js";
import { resolveBodyParserConfig } from "./pages-body-parser-config.js";
import { PagesBodyParseError } from "./pages-media-type.js";
import { createPagesReqRes, markVinextStreamedApiResponse, parsePagesApiBody } from "./pages-node-compat.js";
import { finalizeEdgeApiResponse, isEdgeApiRuntime } from "./edge-api-runtime.js";
//#region src/server/pages-api-route.ts
function resolveModuleRuntime(module) {
	return module.runtime ?? module.config?.runtime;
}
function buildPagesApiQuery(url, params) {
	return mergeRouteParamsIntoQuery(parseQueryString(url), params);
}
function createEdgeApiRequest(request, url, params) {
	const resolvedUrl = new URL(request.url);
	resolvedUrl.search = urlQueryToSearchParams(buildPagesApiQuery(url, params)).toString();
	const resolvedUrlString = resolvedUrl.toString();
	return resolvedUrlString === request.url ? request : cloneRequestWithUrl(request, resolvedUrlString);
}
function isEdgeApiRouteModule(module) {
	return typeof module.default === "function" && isEdgeApiRuntime(resolveModuleRuntime(module));
}
function isNodeApiRouteModule(module) {
	return typeof module.default === "function" && !isEdgeApiRuntime(resolveModuleRuntime(module));
}
async function handlePagesApiRoute(options) {
	if (options.ctx) return runWithExecutionContext(options.ctx, () => _handlePagesApiRoute(options));
	return _handlePagesApiRoute(options);
}
async function _handlePagesApiRoute(options) {
	if (!options.match) return new Response("404 - API route not found", { status: 404 });
	const { route, params } = options.match;
	try {
		if (isEdgeApiRouteModule(route.module)) {
			const nextRequest = new NextRequest(createEdgeApiRequest(options.request, options.url, params), options.nextConfig ? { nextConfig: {
				basePath: options.nextConfig.basePath,
				i18n: options.nextConfig.i18n ?? void 0,
				trailingSlash: options.nextConfig.trailingSlash
			} } : void 0);
			const response = await route.module.default(nextRequest);
			if (response instanceof Response) return finalizeEdgeApiResponse(response, options.edgeRuntime ?? "worker");
			throw new Error("Edge API route did not return a Response");
		}
		if (!isNodeApiRouteModule(route.module)) return new Response("API route does not export a default function", { status: 500 });
		const handler = route.module.default;
		const query = buildPagesApiQuery(options.url, params);
		const bodyParserConfig = resolveBodyParserConfig(route.module.config);
		const body = bodyParserConfig.enabled ? await parsePagesApiBody(options.request, bodyParserConfig.sizeLimit) : void 0;
		const { req, res, responsePromise } = createPagesReqRes({
			allowedRevalidateHeaderKeys: options.nextConfig?.allowedRevalidateHeaderKeys,
			body,
			query,
			request: options.request,
			trustedRevalidateOrigin: options.trustedRevalidateOrigin,
			url: options.url
		});
		let resWasPiped = false;
		res.once("pipe", () => {
			resWasPiped = true;
		});
		const externalResolver = route.module.config?.api?.externalResolver || false;
		const completeHandler = () => {
			if (!externalResolver && !resWasPiped && !res.headersSent) res.end();
		};
		const finalizeResponse = (response) => {
			if (!res.writableEnded) markVinextStreamedApiResponse(response);
			return response;
		};
		const destroyAfterHandlerError = (error) => {
			const normalizedError = error instanceof Error ? error : new Error(String(error));
			res.destroy(normalizedError);
			throw normalizedError;
		};
		const responseReady = responsePromise.then((response) => ({
			type: "response",
			response
		}));
		const handlerCompletion = Promise.resolve().then(() => handler(req, res)).then(() => ({ type: "handler" }), destroyAfterHandlerError);
		const firstSettled = await Promise.race([responseReady, handlerCompletion]);
		if (firstSettled.type === "response") {
			const handlerLifecycle = handlerCompletion.then(completeHandler, (error) => {
				options.reportRequestError?.(error, route.pattern);
			});
			getRequestExecutionContext()?.waitUntil(handlerLifecycle);
			return finalizeResponse(firstSettled.response);
		}
		completeHandler();
		return finalizeResponse(await responsePromise);
	} catch (error) {
		if (error instanceof PagesBodyParseError) return new Response(error.message, {
			status: error.statusCode,
			statusText: error.message
		});
		options.reportRequestError?.(error instanceof Error ? error : new Error(String(error)), route.pattern);
		return internalServerErrorResponse();
	}
}
//#endregion
export { handlePagesApiRoute };
