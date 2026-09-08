//#region src/server/edge-api-runtime.ts
function isEdgeApiRuntime(runtime) {
	return runtime === "edge" || runtime === "experimental-edge";
}
const NODE_EDGE_RESPONSE_FORBIDDEN_HEADERS = [
	"content-length",
	"content-encoding",
	"transfer-encoding"
];
/**
* Remove wire-level body headers after Node's fetch implementation has decoded
* an Edge API response. Next.js applies the same boundary in its edge sandbox.
*
* Workers keep the original response untouched: workerd preserves the encoded
* body/header pair and can stream it directly to the client.
*/
function finalizeEdgeApiResponse(response, runtime) {
	if (runtime === "worker") return response;
	const headers = new Headers(response.headers);
	let changed = false;
	for (const name of NODE_EDGE_RESPONSE_FORBIDDEN_HEADERS) {
		if (!headers.has(name)) continue;
		headers.delete(name);
		changed = true;
	}
	if (!changed) return response;
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText
	});
}
//#endregion
export { finalizeEdgeApiResponse, isEdgeApiRuntime };
