import { afterAll, describe, expect, it } from 'vitest';
import {
  appScript,
  copyFixture,
  expectedTree,
  type Run,
  readTree,
  removeWorkDirs,
  runScript,
  upgrade,
  upgradeSummary,
} from './test-helpers';

afterAll(removeWorkDirs);

describe('a codec the script does not know', () => {
  const unchanged = (run: Run) => ({
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    tree: readTree(run.root),
  });

  it('names each file, the codec and the option, changes no file and exits 1', () => {
    const run = upgrade('unknown-codec');
    const snapshot = Object.keys(expectedTree('unknown-codec', 'before')).find(
      (path) => path.startsWith('migrations/snapshots/') && path.endsWith('/contract.json'),
    );
    expect(unchanged(run)).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        `${snapshot}: unknown codec acme/shape@1; name its data type with --data-type acme/shape@1=<data type id>`,
        'prisma/contract.json: unknown codec acme/shape@1; name its data type with --data-type acme/shape@1=<data type id>',
        '',
      ].join('\n'),
      tree: expectedTree('unknown-codec', 'before'),
    });
  });

  it('upgrades when --data-type names its data type', () => {
    const run = runScript(copyFixture('unknown-codec', 'before'), appScript, [
      '--data-type',
      'acme/shape@1=acme/shape',
    ]);
    expect(unchanged(run)).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 3 files and renamed 1 snapshot directory.', [
        [
          '90ad54a8bc204f3991426b445dcc4c89a1401f51f95c3ba815fbc68fd140df97',
          'f31f81776a87ddfcabd2ef4929e374d4249a10a8302f4cef50716bc8dad8485f',
        ],
      ]),
      stderr: '',
      tree: expectedTree('unknown-codec', 'after'),
    });
  });

  for (const value of ['acme/shape@1', 'acme/shape@1=', '=acme/shape', 'acme/shape@1=Acme Shape']) {
    it(`refuses the malformed value ${JSON.stringify(value)} without changing a file`, () => {
      const run = runScript(copyFixture('unknown-codec', 'before'), appScript, [
        '--data-type',
        value,
      ]);
      expect(unchanged(run)).toEqual({
        status: 1,
        stdout: '',
        stderr: `--data-type ${value}: expected <codec id>=<data type id>, for example acme/shape@1=acme/shape\n`,
        tree: expectedTree('unknown-codec', 'before'),
      });
    });
  }

  it('refuses to change the data type of a codec it already knows', () => {
    const run = runScript(copyFixture('unknown-codec', 'before'), appScript, [
      '--data-type',
      'acme/shape@1=acme/shape',
      '--data-type',
      'pg/uuid@1=pg/text',
    ]);
    expect(unchanged(run)).toEqual({
      status: 1,
      stdout: '',
      stderr:
        '--data-type pg/uuid@1=pg/text: the script already maps pg/uuid@1 to pg/uuid on target postgres\n',
      tree: expectedTree('unknown-codec', 'before'),
    });
  });
});

describe('a contract on a target the script does not know', () => {
  it('takes --data-type for a codec the script maps on other targets', () => {
    const run = runScript(copyFixture('unknown-target', 'before'), appScript, [
      '--data-type',
      'sql/int@1=acme/int4',
    ]);
    expect({
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      tree: readTree(run.root),
    }).toEqual({
      status: 0,
      stdout: upgradeSummary('Rewrote 3 files and renamed 1 snapshot directory.', [
        [
          'c8a500bce17514ecce4c3638f7e3e0447ac842502b8480d32725fdcc5141aa6d',
          '3a6ffdf836b1e29fd2ffd8b5118ffd732a87d461bce83b11b0e4dfb4db396a0b',
        ],
      ]),
      stderr: '',
      tree: expectedTree('unknown-target', 'after'),
    });
  });
});
