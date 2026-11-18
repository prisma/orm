import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'pathe';

export interface ContractDepsValidation {
  readonly missing: readonly string[];
  readonly warning?: string;
}

function isCheckedModule(module: string): boolean {
  return !module.startsWith('#') && !module.startsWith('./') && !module.startsWith('../');
}

function packageOf(module: string): string {
  const segments = module.split('/');
  return segments.slice(0, module.startsWith('@') ? 2 : 1).join('/');
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function isInstalled(pkg: string, resolve: NodeJS.Require): boolean {
  try {
    resolve.resolve(`${pkg}/package.json`);
    return true;
  } catch (error) {
    return errorCode(error) !== 'MODULE_NOT_FOUND';
  }
}

export function validateContractDeps(
  modules: readonly string[],
  outputDir: string,
): ContractDepsValidation {
  const resolve = createRequire(resolvePath(outputDir, 'package.json'));
  const packages = [...new Set(modules.filter(isCheckedModule).map(packageOf))];
  const missing = packages.filter((pkg) => !isInstalled(pkg, resolve));
  if (missing.length === 0) {
    return { missing };
  }
  const warning = [
    'contract.d.ts imports types from packages that are not installed:',
    ...missing.map((pkg) => `  - ${pkg}`),
    '',
    'Install them with your package manager:',
    ...missing.map((pkg) => `  ${pkg}`),
  ].join('\n');
  return { missing, warning };
}
