import { UrlQuery } from "../../utils/query.js";
//#region src/shims/internal/interpolate-as.d.ts
/**
 * Wire-compatible alias for Node's `querystring.ParsedUrlQuery`. Inlined here
 * so this module has no dependency on the `querystring` types package.
 */
type ParsedUrlQuery = {
  [key: string]: string | string[] | undefined;
};
type DynamicRouteHrefProjection = {
  href: string;
  params: string[];
  query: ParsedUrlQuery;
  routePathname: string;
};
type DynamicRouteHrefResolution = {
  /** Route-pattern URL passed to the Pages Router. */
  href: string;
  /** Interpolated URL rendered in the anchor and displayed in the browser. */
  as: string;
};
/**
 * Resolve a bracket-pattern route href against its displayed href. Query
 * values can be supplied directly (object-form hrefs) or parsed from the route
 * href (string-form hrefs). A `?` after `#` is part of the fragment, not a
 * query delimiter.
 */
declare function interpolateDynamicRouteHref(routeHref: string, asHref: string, queryInput?: UrlQuery): DynamicRouteHrefProjection | null;
/**
 * Resolve the two URLs that Next.js' Pages Router derives from a dynamic
 * href: the original route-pattern URL used to load the page and the
 * interpolated browser URL. Dynamic params are consumed from the latter's
 * query string while unrelated query values and the hash are retained.
 *
 * Mirrors `resolveHref(router, href, true)` from Next.js:
 * packages/next/src/client/resolve-href.ts.
 */
declare function resolveDynamicRouteHref(routeHref: string): DynamicRouteHrefResolution | null;
//#endregion
export { DynamicRouteHrefProjection, DynamicRouteHrefResolution, interpolateDynamicRouteHref, resolveDynamicRouteHref };