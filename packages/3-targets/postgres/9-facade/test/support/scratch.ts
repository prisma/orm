import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'pathe';

const scratchRoot = join(import.meta.dirname, '..', '..', '.tmp-output');

/** A new directory inside this package for a test's files. The test removes it. */
export async function scratchDir(prefix: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true });
  return mkdtemp(join(scratchRoot, prefix));
}
