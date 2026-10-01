import { extname } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

function staticPrefixDirectory(pattern: string): string {
  const staticSegments: string[] = [];
  for (const segment of pattern.replaceAll('\\', '/').split('/')) {
    if (isDynamicPattern(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/');
}

/**
 * Where `contract emit` writes the contract JSON for a config that names
 * `contractPath` and sets no output: beside the contract file and named after
 * it, or `contract.json` in the static prefix directory of a glob.
 */
export function defaultContractOutputPath(contractPath: string): string {
  if (isDynamicPattern(contractPath)) {
    const prefix = staticPrefixDirectory(contractPath);
    return prefix.length === 0 ? 'contract.json' : `${prefix}/contract.json`;
  }
  const extension = extname(contractPath);
  return `${extension.length === 0 ? contractPath : contractPath.slice(0, -extension.length)}.json`;
}
