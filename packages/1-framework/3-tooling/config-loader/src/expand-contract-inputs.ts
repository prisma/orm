import { glob, stat } from 'node:fs/promises';
import { matchesGlob } from 'node:path';
import { resolve } from 'pathe';

async function isSymlinkFile(path: string): Promise<boolean> {
  try {
    return (await stat(path, { throwIfNoEntry: false }))?.isFile() ?? false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      return false;
    }
    throw error;
  }
}

export async function expandContractInputs(
  patterns: readonly string[] | undefined,
): Promise<readonly string[]> {
  if (patterns === undefined || patterns.length === 0) {
    return [];
  }
  const canonical = new Set<string>();
  for await (const entry of glob(patterns, { withFileTypes: true })) {
    const path = resolve(entry.parentPath, entry.name);
    if (entry.isFile() || (entry.isSymbolicLink() && (await isSymlinkFile(path)))) {
      canonical.add(path);
    }
  }
  return Array.from(canonical).sort();
}

export function globContractInputMatching(
  patterns: readonly string[],
  path: string,
): string | undefined {
  return patterns.find((pattern) => matchesGlob(path, pattern));
}
