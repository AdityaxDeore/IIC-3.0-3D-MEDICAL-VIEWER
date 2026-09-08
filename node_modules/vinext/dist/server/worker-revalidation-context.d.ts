import { ExecutionContextLike } from "../shims/request-context.js";
//#region src/server/worker-revalidation-context.d.ts
type PlatformExecutionContext = Partial<ExecutionContextLike>;
/**
 * Add a request-local, in-process Pages revalidation dispatcher to a Worker
 * execution context. Re-entering with the derived internal context preserves
 * the authenticated protocol headers while keeping ordinary inbound requests
 * on the normal header-scrubbing path.
 */
declare function createWorkerRevalidationContext(base: PlatformExecutionContext | undefined, handleInternalRequest: (request: Request, ctx: ExecutionContextLike) => Promise<Response>): ExecutionContextLike;
//#endregion
export { createWorkerRevalidationContext };