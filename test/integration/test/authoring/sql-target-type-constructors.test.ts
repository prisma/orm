import { readdirSync, readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqlFamily from '@internal/family-sql/control';
import sqlFamilyPack, { sqlTargetTypeConstructors } from '@internal/family-sql/pack';
import { createControlStack } from '@internal/framework-components/control';
import { generatedIdColumnAliases } from '@internal/sql-contract/generated-id-column-aliases';
import postgresControl from '@internal/target-postgres/control';
import sqliteControl from '@internal/target-sqlite/control';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const databasesDirectory = join(import.meta.dirname, '../../../../packages/3-targets');

const targetPackageNames = readdirSync(databasesDirectory).map((database): string => {
  const manifest: { readonly name: string } = JSON.parse(
    readFileSync(join(databasesDirectory, database, '1-target', 'package.json'), 'utf8'),
  );
  return manifest.name;
});

interface TargetComponent {
  readonly familyId?: string;
  readonly authoring?: { readonly type?: { readonly sql?: Record<string, unknown> } };
}

async function targetComponents(names: readonly string[], entryPoint: 'pack' | 'control') {
  return Promise.all(
    names.map(async (name) => {
      const module: { readonly default: TargetComponent } = await import(`${name}/${entryPoint}`);
      return { name, component: module.default };
    }),
  );
}

async function sqlTargetComponents(entryPoint: 'pack' | 'control') {
  const packs = await targetComponents(targetPackageNames, 'pack');
  const sqlTargetNames = packs
    .filter(({ component }) => component.familyId === 'sql')
    .map(({ name }) => name);
  return targetComponents(sqlTargetNames, entryPoint);
}

describe.each(['pack', 'control'] as const)('every SQL target %s', (entryPoint) => {
  it.each(['String', 'Char'] as const)(
    'contributes sql.%s, built by sqlTargetTypeConstructors',
    async (name) => {
      const targets = await sqlTargetComponents(entryPoint);
      expect(targets.map(({ name }) => name).sort()).toEqual([
        '@internal/target-mysql',
        '@internal/target-postgres',
        '@internal/target-sqlite',
      ]);
      for (const { component } of targets) {
        const contributed = component.authoring?.type?.sql?.[name];
        const built = sqlTargetTypeConstructors({ sizeType: 'unused' }).sql[name];
        expect(contributed).toMatchObject({ kind: built.kind, output: built.output });
      }
    },
  );
});

const ALIASES = Object.keys(generatedIdColumnAliases).sort();

describe('the generated id column aliases', () => {
  it('are contributed in sql by the family pack and control descriptor, not by a target', async () => {
    const targets = [
      ...(await sqlTargetComponents('pack')),
      ...(await sqlTargetComponents('control')),
    ];
    expect({
      pack: sqlFamilyPack.authoring.type.sql,
      control: sqlFamily.authoring.type.sql,
      fromTargets: targets.flatMap(({ component }) =>
        Object.keys(component.authoring?.type?.sql ?? {}).filter((name) => ALIASES.includes(name)),
      ),
    }).toEqual({
      pack: generatedIdColumnAliases,
      control: generatedIdColumnAliases,
      fromTargets: [],
    });
  });

  it.each([
    [
      'postgres',
      createControlStack({ family: sqlFamily, target: postgresControl, adapter: postgresAdapter }),
    ],
    [
      'sqlite',
      createControlStack({ family: sqlFamily, target: sqliteControl, adapter: sqliteAdapter }),
    ],
  ] as const)('are in sql on the assembled %s stack', (_, stack) => {
    const sql = stack.authoringContributions.type['sql'];
    expect(
      Object.fromEntries(
        ALIASES.map((alias) => [alias, sql === undefined ? undefined : Reflect.get(sql, alias)]),
      ),
    ).toEqual(generatedIdColumnAliases);
  });
});
