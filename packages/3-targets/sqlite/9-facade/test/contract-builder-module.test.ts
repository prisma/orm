import { readFileSync } from 'node:fs';
import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { contractBuilderModule } from '../src/config/components';
import { moduleBase } from '../src/config/module-base';

const facadeDir = resolve(import.meta.dirname, '..');
const exportsOf = (packageDir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8')).exports;

describe('the module the refusal of a contract built for another target names', () => {
  it('is a subpath of the module base that the package and its published package both map to its built entry', () => {
    const subpath = contractBuilderModule.slice(moduleBase.length);
    expect({
      subpath,
      base: contractBuilderModule.startsWith(`${moduleBase}/`),
      internal: exportsOf(facadeDir)[`.${subpath}`],
      published: exportsOf(resolve(facadeDir, '../../..', '9-public/@prisma/orm-sqlite'))[
        `.${subpath}`
      ],
    }).toEqual({
      subpath: '/contract-builder',
      base: true,
      internal: './dist/contract-builder.mjs',
      published: './dist/contract-builder.mjs',
    });
  });
});
