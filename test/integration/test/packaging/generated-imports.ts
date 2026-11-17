/**
 * The modules a generated file may import from, as the design record states
 * it: the config's types module and migration module, an installed
 * extension's own package, or a relative path. Nothing else, so no generated
 * file names a private workspace module or a package the application does
 * not depend on directly.
 */
export interface GeneratedImportRules {
  readonly typesModule: string;
  readonly migrationModule: string;
  /** Extension packages the application installs, each of which may be imported by any subpath. */
  readonly extensionPackages: readonly string[];
  /** Every package the application declares in its own `package.json`. */
  readonly directDependencies: readonly string[];
}

const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(['"])([^'"]+)\1/gm;

/** The module specifiers a source file imports. */
export function importedModules(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map(([, , specifier]) => specifier ?? '');
}

function packageOf(specifier: string): string {
  const [first, second] = specifier.split('/');
  return specifier.startsWith('@') ? `${first}/${second}` : (first ?? '');
}

/** Each import of `source` that breaks the rules, with the reason. */
export function generatedImportProblems(source: string, rules: GeneratedImportRules): string[] {
  const problems: string[] = [];
  for (const module of importedModules(source)) {
    if (module.startsWith('./') || module.startsWith('../')) continue;
    if (module.startsWith('@internal/')) {
      problems.push(`${module}: a private workspace module`);
      continue;
    }
    if (!rules.directDependencies.includes(packageOf(module))) {
      problems.push(`${module}: a package the application does not depend on directly`);
      continue;
    }
    const allowed =
      module === rules.typesModule ||
      module === rules.migrationModule ||
      rules.extensionPackages.includes(packageOf(module));
    if (!allowed) {
      problems.push(`${module}: neither a module the config names nor an extension's own`);
    }
  }
  return problems;
}
