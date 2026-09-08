import { RequestContext } from "../config/request-context.js";
import { BasePathMatchState } from "../config/config-matchers.js";
import { ClientRewrite } from "./client-rewrites.js";
//#region src/client/client-rewrite-matcher.d.ts
declare function matchClientRewrite(pathname: string, rewrite: ClientRewrite, context: RequestContext, basePathState: BasePathMatchState): {
  kind: "rewrite";
  destination: string;
} | {
  kind: "server";
} | null;
//#endregion
export { matchClientRewrite };