import { readFileSync } from 'node:fs';
import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { contractBuilderModule } from '../src/config/components';
import { moduleBase } from '../src/config/module-base';

const facadeDir = resolve(import.meta.dirname, '..');
const exportsOf = (packageDir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')).exports;

describe('the module the refusal of a contract built for another target names', () => {
  it('is a subpath of the module base that the package and its published package both export', () => {
    const subpath = contractBuilderModule.slice(moduleBase.length);
    expect({
      base: contractBuilderModule.startsWith(`${moduleBase}/`),
      internal: `.${subpath}` in exportsOf(facadeDir),
      published:
        `.${subpath}` in
        exportsOf(resolve(facadeDir, '../../../..', '9-public/@prisma/orm-mariadb')),
    }).toEqual({ base: true, internal: true, published: true });
  });
});
