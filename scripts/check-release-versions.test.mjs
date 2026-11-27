import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { versionChanges, versionChangesReport } from './check-release-versions.mjs';

describe('versionChanges', () => {
  it('lists each package whose planned version is not the committed one', () => {
    deepStrictEqual(
      versionChanges(
        { '@prisma/orm-mysql': '8.1.0-ea.0', '@prisma/orm-postgres': '8.1.0' },
        { '@prisma/orm-mysql': '8.1.0', '@prisma/orm-postgres': '8.1.0' },
      ),
      [{ name: '@prisma/orm-mysql', committed: '8.1.0-ea.0', planned: '8.1.0' }],
    );
  });

  it('is empty when every committed version is the planned one', () => {
    deepStrictEqual(versionChanges({ '@prisma/orm-a': '8.1.0' }, { '@prisma/orm-a': '8.1.0' }), []);
  });
});

describe('versionChangesReport', () => {
  it('names each package with its committed and planned version', () => {
    strictEqual(
      versionChangesReport(
        [{ name: '@prisma/orm-mysql', committed: '8.1.0-ea.0', planned: '8.1.0' }],
        '8.1.0',
      ),
      [
        'set-version.ts planned versions other than the committed ones for these packages:',
        '  @prisma/orm-mysql: committed 8.1.0-ea.0, planned 8.1.0',
        'The release pull request must commit the versions set-version.ts writes: run node scripts/set-version.ts 8.1.0 on its branch and commit the result.',
      ].join('\n'),
    );
  });

  it('is undefined when nothing changed', () => {
    strictEqual(versionChangesReport([], '8.1.0'), undefined);
  });
});
