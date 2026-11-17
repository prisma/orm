import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'node:path';

const IMPORT_PATTERN = /import\s+type\s+.*?\s+from\s+['"](@[^/]+\/[^/'"]+)/g;

export function extractPackageSpecifiers(dtsContent: string): string[] {
  const packages = new Set<string>();
  for (const match of dtsContent.matchAll(IMPORT_PATTERN)) {
    const pkg = match[1];
    if (pkg) packages.add(pkg);
  }
  return [...packages];
}

export interface ContractDepsValidation {
  readonly missing: readonly string[];
  readonly warning?: string;
}

export function validateContractDeps(
  dtsContent: string,
  projectRoot: string,
): ContractDepsValidation {
  const packages = extractPackageSpecifiers(dtsContent);
  // createRequire requires an absolute path; the project root arrives
  // relative when the command is invoked with a relative --project.
  const resolve = createRequire(resolvePath(projectRoot, 'package.json'));

  const missing: string[] = [];
  for (const pkg of packages) {
    try {
      resolve.resolve(`${pkg}/package.json`);
    } catch {
      missing.push(pkg);
    }
  }

  if (missing.length === 0) {
    return { missing };
  }

  const list = missing.map((p) => `  - ${p}`).join('\n');
  const warning = [
    'contract.d.ts imports types from packages that are not installed:',
    list,
    '',
    'Install them with your package manager:',
    ...missing.map((p) => `  ${p}`),
  ].join('\n');

  return { missing, warning };
}
