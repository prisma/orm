export interface GeneratedImportRules {
  readonly typesModule: string;
  readonly migrationModule: string;
  readonly extensionPackages: readonly string[];
  readonly directDependencies: readonly string[];
}

const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)(['"])([^'"]+)\1/gm;

export function importedModules(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER)].map(([, , specifier]) => specifier ?? '');
}

function packageOf(specifier: string): string {
  const [first, second] = specifier.split('/');
  return specifier.startsWith('@') ? `${first}/${second}` : (first ?? '');
}

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
