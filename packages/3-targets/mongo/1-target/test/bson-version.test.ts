import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

interface PackageJson {
  readonly name?: string;
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

function packageJsonOf(name: string): PackageJson {
  let dir = dirname(require.resolve(name));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    try {
      const json: PackageJson = JSON.parse(readFileSync(candidate, 'utf8'));
      if (json.name === name) return json;
    } catch {}
    dir = dirname(dir);
  }
  throw new Error(`no package.json for ${name}`);
}

function majorOf(versionOrRange: string): number {
  const match = /(\d+)\./.exec(versionOrRange);
  if (match === null) throw new Error(`no major version in "${versionOrRange}"`);
  return Number(match[1]);
}

describe('bson version', () => {
  it('shares its major with the bson range the installed mongodb declares', () => {
    const bson = packageJsonOf('bson');
    const mongodbBsonRange = packageJsonOf('mongodb').dependencies?.['bson'];
    expect(mongodbBsonRange).toMatch(/\d+\./);
    expect(majorOf(bson.version)).toBe(majorOf(mongodbBsonRange ?? ''));
  });
});
