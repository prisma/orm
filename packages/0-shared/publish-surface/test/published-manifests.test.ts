import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { publicShells } from '../src/shells';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** `prisma orm init` installs or uses a target package only when its manifest lists this keyword. */
const INIT_KEYWORD = 'prisma-orm-extension';

function manifestOf(dir: string): { readonly exports: object; readonly keywords: unknown } {
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(`${dir}/package.json is not an object`);
  }
  const exports: unknown = Reflect.get(manifest, 'exports');
  return {
    exports: typeof exports === 'object' && exports !== null ? exports : {},
    keywords: Reflect.get(manifest, 'keywords'),
  };
}

describe('published manifests', () => {
  it('list the keyword init requires on every package that exports ./init', () => {
    const withInit = [...publicShells].filter(([, shell]) =>
      Object.hasOwn(manifestOf(shell.dir).exports, './init'),
    );
    const missing = withInit
      .filter(([, shell]) => {
        const { keywords } = manifestOf(shell.dir);
        return !(Array.isArray(keywords) && keywords.includes(INIT_KEYWORD));
      })
      .map(([name]) => name);

    expect(withInit.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
