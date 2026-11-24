import { describe, expect, it } from 'vitest';
import { planRelease } from '../src/release-plan';
import { planTable, realGraph } from './release-plan-fixtures';

/**
 * What each of the published packages is released as, one line per package: its name without
 * `@prisma/orm-`, its version, its tag, and the range it writes on each package of ours it names.
 */
const AT_8_0_0 = `
    better-auth                 8.0.0-preview.0  latest  family-sql ^8.0.0, framework ^8.0.0
    extension-arktype-json      8.0.0            latest  family-sql ^8.0.0, framework ^8.0.0, target-postgres ^8.0.0
    extension-middleware-cache  8.0.0-preview.0  latest  framework ^8.0.0
    extension-paradedb          0.1.0            latest  family-sql ^8.0.0, framework ^8.0.0, toolchain ^8.0.0
    extension-pgvector          8.0.0            latest  family-sql ^8.0.0, framework ^8.0.0, target-postgres ^8.0.0, toolchain ^8.0.0
    extension-postgis           8.0.0            latest  family-sql ^8.0.0, framework ^8.0.0, target-postgres ^8.0.0, toolchain ^8.0.0
    extension-supabase          8.0.0-preview.0  latest  family-sql ^8.0.0, framework ^8.0.0, postgres ^8.0.0, target-postgres ^8.0.0, toolchain ^8.0.0
    family-mongo                8.0.0-preview.0  latest  framework ~8.0.0, toolchain ~8.0.0
    family-sql                  8.0.0            latest  framework ~8.0.0, toolchain ~8.0.0
    framework                   8.0.0            latest  -
    mariadb                     8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, mysql ~8.0.0-ea.0, target-mariadb ~8.0.0-ea.0, target-mysql ~8.0.0-ea.0, toolchain ~8.0.0
    mongo                       8.0.0-preview.0  latest  family-mongo ~8.0.0-preview.0, framework ~8.0.0, target-mongo ~8.0.0-preview.0, toolchain ~8.0.0
    mysql                       8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, target-mysql ~8.0.0-ea.0, toolchain ~8.0.0
    postgres                    8.0.0            latest  family-sql ~8.0.0, framework ~8.0.0, target-postgres ~8.0.0, toolchain ~8.0.0
    postgres-contrib            8.0.0            latest  family-sql ^8.0.0, framework ^8.0.0, target-postgres ^8.0.0, toolchain ^8.0.0
    sqlite                      8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, target-sqlite ~8.0.0-ea.0, toolchain ~8.0.0
    target-mariadb              8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, target-mysql ~8.0.0-ea.0
    target-mongo                8.0.0-preview.0  latest  family-mongo ~8.0.0-preview.0, framework ~8.0.0, toolchain ~8.0.0
    target-mysql                8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, toolchain ~8.0.0
    target-postgres             8.0.0            latest  family-sql ~8.0.0, framework ~8.0.0, toolchain ~8.0.0
    target-sqlite               8.0.0-ea.0       latest  family-sql ~8.0.0, framework ~8.0.0, toolchain ~8.0.0
    toolchain                   8.0.0            latest  framework ~8.0.0
`;

const AT_8_1_0 = `
    better-auth                 8.1.0-preview.0  latest  family-sql ^8.1.0, framework ^8.1.0
    extension-arktype-json      8.1.0            latest  family-sql ^8.1.0, framework ^8.1.0, target-postgres ^8.1.0
    extension-middleware-cache  8.1.0-preview.0  latest  framework ^8.1.0
    extension-paradedb          0.1.0            latest  family-sql ^8.1.0, framework ^8.1.0, toolchain ^8.1.0
    extension-pgvector          8.1.0            latest  family-sql ^8.1.0, framework ^8.1.0, target-postgres ^8.1.0, toolchain ^8.1.0
    extension-postgis           8.1.0            latest  family-sql ^8.1.0, framework ^8.1.0, target-postgres ^8.1.0, toolchain ^8.1.0
    extension-supabase          8.1.0-preview.0  latest  family-sql ^8.1.0, framework ^8.1.0, postgres ^8.1.0, target-postgres ^8.1.0, toolchain ^8.1.0
    family-mongo                8.1.0-preview.0  latest  framework ~8.1.0, toolchain ~8.1.0
    family-sql                  8.1.0            latest  framework ~8.1.0, toolchain ~8.1.0
    framework                   8.1.0            latest  -
    mariadb                     8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, mysql ~8.1.0-ea.0, target-mariadb ~8.1.0-ea.0, target-mysql ~8.1.0-ea.0, toolchain ~8.1.0
    mongo                       8.1.0-preview.0  latest  family-mongo ~8.1.0-preview.0, framework ~8.1.0, target-mongo ~8.1.0-preview.0, toolchain ~8.1.0
    mysql                       8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, target-mysql ~8.1.0-ea.0, toolchain ~8.1.0
    postgres                    8.1.0            latest  family-sql ~8.1.0, framework ~8.1.0, target-postgres ~8.1.0, toolchain ~8.1.0
    postgres-contrib            8.1.0            latest  family-sql ^8.1.0, framework ^8.1.0, target-postgres ^8.1.0, toolchain ^8.1.0
    sqlite                      8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, target-sqlite ~8.1.0-ea.0, toolchain ~8.1.0
    target-mariadb              8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, target-mysql ~8.1.0-ea.0
    target-mongo                8.1.0-preview.0  latest  family-mongo ~8.1.0-preview.0, framework ~8.1.0, toolchain ~8.1.0
    target-mysql                8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, toolchain ~8.1.0
    target-postgres             8.1.0            latest  family-sql ~8.1.0, framework ~8.1.0, toolchain ~8.1.0
    target-sqlite               8.1.0-ea.0       latest  family-sql ~8.1.0, framework ~8.1.0, toolchain ~8.1.0
    toolchain                   8.1.0            latest  framework ~8.1.0
`;

describe('the plan for the published packages', () => {
  it('publishes every package at 8.0.0-rc.26 with exact ranges while the line is the 8.0.0 release candidates', () => {
    const graph = realGraph();
    const plan = planRelease({
      ...graph,
      release: { major: 8, minor: 0 },
      line: 'release-candidates',
      rcCounter: 26,
      current: graph.currentAll('8.0.0-rc.25'),
      everGa: new Set(),
      bump: [],
      dev: undefined,
    });

    for (const [name, planned] of Object.entries(plan)) {
      expect({ name, version: planned.version, tag: planned.tag }).toEqual({
        name,
        version: '8.0.0-rc.26',
        tag: 'latest',
      });
      expect(Object.values(planned.ranges).every((range) => range === '8.0.0-rc.26')).toBe(true);
      expect(Object.keys(planned.ranges).sort()).toEqual([...graph.uses[name]!].sort());
    }
    expect(Object.keys(plan)).toHaveLength(22);
  });

  it('moves every package to its level’s first version of 8.0 at 8.0.0', () => {
    const graph = realGraph();
    const plan = planRelease({
      ...graph,
      release: { major: 8, minor: 0 },
      line: 'levels',
      rcCounter: undefined,
      current: { ...graph.currentAll('8.0.0-rc.26'), '@prisma/orm-extension-paradedb': '0.1.0' },
      everGa: new Set(),
      bump: [],
      dev: undefined,
    });

    expect(planTable(plan)).toEqual(planTable.parse(AT_8_0_0));
  });

  it('publishes 8.1.0', () => {
    const graph = realGraph();
    const plan = planRelease({
      ...graph,
      release: { major: 8, minor: 1 },
      line: 'levels',
      rcCounter: undefined,
      current: planTable.versions(AT_8_0_0),
      everGa: graph.gaPackages(),
      bump: [],
      dev: undefined,
    });

    expect(planTable(plan)).toEqual(planTable.parse(AT_8_1_0));
  });
});
