import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'pathe';
import { emptyProject, HASH_A, harness, refPointerPath } from './ref-fixtures';

/** A project with no migrations and one ref file holding `content` exactly as given. */
export async function projectWithRef(
  name: string,
  content: unknown,
): Promise<{ readonly dir: string; readonly path: string }> {
  const dir = await emptyProject();
  const path = await writeRefText(dir, name, content);
  return { dir, path };
}

/** Writes a ref file as a person would by hand: `content` as JSON with four-space indentation, or a string as it is. */
export async function writeRefText(dir: string, name: string, content: unknown): Promise<string> {
  const path = refPointerPath(dir, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof content === 'string' ? content : JSON.stringify(content, null, 4));
  return path;
}

/** The text every ref writer produces for `content`. */
export function refFileText(content: unknown): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

export function readText(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

export function runPolicy(dir: string, args: readonly string[]) {
  return harness().run(['migration', 'ref', 'policy', ...args], { cwd: dir });
}

export const PLAIN_REF = { formatVersion: 1, hash: HASH_A, invariants: [] } as const;
