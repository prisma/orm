/**
 * Rewrites one module specifier for the import root a generated file is being
 * emitted for. Specifiers the root does not govern — relative paths, `node:`
 * builtins, third-party packages — come back unchanged.
 *
 * Emission is handed a resolver rather than a mode because the map from
 * workspace names to published names is packaging data (ADR 242), which
 * `@internal/publish-surface/import-roots` owns. Nothing here needs to know
 * what the published names are.
 */
export type ImportSpecifierResolver = (specifier: string) => string;

/**
 * Emits every specifier exactly as authored. This is the default everywhere:
 * generated files keep naming workspace packages until every consumer in the
 * repository imports published names instead.
 */
export const keepInternalSpecifiers: ImportSpecifierResolver = (specifier) => specifier;
