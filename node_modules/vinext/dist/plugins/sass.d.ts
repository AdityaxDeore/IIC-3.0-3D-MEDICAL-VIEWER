import { ResolvedConfig } from "vite";
//#region src/plugins/sass.d.ts
type AdditionalData = string | ((source: string, filename: string) => string | Promise<string>);
type VitePreprocessorOptions = {
  additionalData?: AdditionalData;
  loadPaths?: string[];
  [key: string]: any;
};
type SassTsconfigPathAlias = {
  find: string;
  replacements: readonly string[];
};
type SassFileImporterContext = {
  containingUrl?: URL | null;
};
type SassFileImporter = {
  findFileUrl(url: string, context?: SassFileImporterContext): URL | null;
};
/**
 * Create Sass `FileImporter`s for paths materialized from tsconfig.
 *
 * Vite does not apply tsconfig path aliases while resolving Sass loads. Vinext
 * deliberately extends that behavior for migration compatibility: application
 * stylesheets may use the same exact and single-wildcard mappings as source
 * modules. This is a vinext capability, not Next.js parity; current Next.js
 * webpack builds do not resolve tsconfig `paths` from Sass.
 *
 * One importer is emitted per ordered replacement slot. When Sass cannot find
 * a file for the first target it advances to the next importer, preserving the
 * fallback order from `paths`. All importers select the same best pattern, so a
 * failed specific mapping never falls through to a less-specific mapping.
 *
 * Aliases stay scoped to application stylesheets. Loads originating in
 * `node_modules`, plus absolute, relative, protocol-relative, and scheme URLs,
 * are left to user and Vite importers.
 */
declare function createSassTsconfigPathImporters(aliases: readonly SassTsconfigPathAlias[]): SassFileImporter[];
/**
 * Create a Sass `FileImporter` that resolves webpack-style tilde (`~`) imports.
 *
 * Next.js (via sass-loader's `webpackImporter`) supports two tilde forms:
 *
 * 1. `~pkg/path` — resolves `pkg/path` from `node_modules`. Used for
 *    third-party SCSS/CSS, e.g. `@import '~nprogress/nprogress.css'`.
 *
 * 2. `~/path` — resolves relative to the **project root** (the `~` acts as
 *    an alias for the root). Used with Turbopack's `resolveAlias: { '~*': '*' }`
 *    convention, e.g. `@use '~/styles/variables' as *`.
 *
 * Vite's built-in Sass resolver does not strip the `~` prefix, so any SCSS
 * that uses tilde imports fails with "Can't find stylesheet to import" errors.
 * This `FileImporter` runs before Vite's internal importer (added at the end
 * of `importers[]` in the vite:css plugin) and canonicalises tilde URLs so
 * Sass can load them from the filesystem.
 *
 * The returned object implements the modern Sass `FileImporter` interface:
 * `findFileUrl` returns a `file://` URL and Sass automatically handles partial
 * resolution (`_variables.scss` for `variables`), index files, and extensions.
 *
 * @param root - Absolute path to the Vite project root (used as the base for
 *   `~/path` resolution and for locating `node_modules`).
 */
declare function createSassTildeImporter(root: string): {
  findFileUrl(url: string): URL | null;
};
type SassLoadedStylesheet = {
  contents: string;
  syntax: "scss" | "indented" | "css";
};
/**
 * Preserve source-asset provenance for `url()` references inside imported Sass
 * partials. Vite's transform hook only sees the entry stylesheet after Sass has
 * flattened its imports, at which point relative URLs from a partial have lost
 * the partial's source filename. Marking the partial before compilation keeps
 * byte-identical assets associated with their original basenames.
 */
declare function createSassCssUrlAssetImporter(): {
  canonicalize(url: string): URL | null;
  load(canonicalUrl: URL): SassLoadedStylesheet | null;
  rewriteImports(source: string, filename: string): string;
};
declare function buildSassPreprocessorOptions(sassOptions: Record<string, unknown> | null | undefined): VitePreprocessorOptions | undefined;
/**
 * Create a per-build binding of {@link SassAwareFileSystemLoader}.
 *
 * Returns:
 * - `Loader` — a class to inject as postcss-modules' `css.modules.Loader`
 *   option. postcss-modules instantiates it with the fixed
 *   `(root, plugins, fileResolve)` signature, so the resolved Vite config is
 *   captured in this factory's closure rather than passed to the constructor.
 * - `setResolvedConfig` — called from vinext's `configResolved` hook to bind
 *   that build's resolved config.
 *
 * One binding is created per vinext plugin instance, so concurrent or
 * back-to-back builds in a single process never observe another build's
 * config (root, sass options, `generateScopedName`, logger, …).
 */
declare function createSassAwareFileSystemLoader(): {
  Loader: new (root: string, plugins: unknown[], fileResolve?: (newPath: string, relativeTo: string) => Promise<string>) => {
    fetch(newPath: string, relativeTo: string, trace?: string): Promise<Record<string, string>>;
    readonly finalSource: string;
  };
  setResolvedConfig: (config: ResolvedConfig) => void;
};
//#endregion
export { SassTsconfigPathAlias, buildSassPreprocessorOptions, createSassAwareFileSystemLoader, createSassCssUrlAssetImporter, createSassTildeImporter, createSassTsconfigPathImporters };