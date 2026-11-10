import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addExtensionSpace,
  buildProject,
  C1,
  C2,
  drawingLines,
  EMPTY,
  EXT_C1,
  harness,
  mocks,
  ormConfig,
  pgvectorExtension,
  removeMigrateShowProjects,
  resetMigrateShowMocks,
} from './fixtures/migrate-show-project';

afterEach(removeMigrateShowProjects);
beforeEach(resetMigrateShowMocks);

describe('migrate --show with extension spaces', () => {
  it('plans extensions from the empty contract, never from the app --from hash', async () => {
    const cwd = await buildProject();
    const extDirName = await addExtensionSpace(cwd);

    const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
      ['db', 'migrate', '--show', '--from', C1.slice(7, 13), '--to', C2.slice(7, 13), '--json'],
      { cwd },
    );
    const document = run.presented?.data as {
      migrations: ReadonlyArray<{ spaceId: string; dirName: string; from: string }>;
    };

    expect(run.exitCode).toBe(0);
    expect(document.migrations).toContainEqual(
      expect.objectContaining({ spaceId: 'pgvector', dirName: extDirName, from: EMPTY }),
    );
    expect(document.migrations).not.toContainEqual(
      expect.objectContaining({ spaceId: 'app', from: EMPTY }),
    );
  });

  it('orders extension migrations before app migrations, matching the runner', async () => {
    const cwd = await buildProject();
    await addExtensionSpace(cwd);

    const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
      ['db', 'migrate', '--show', '--from', EMPTY, '--json'],
      { cwd },
    );
    const document = run.presented?.data as {
      migrations: ReadonlyArray<{ spaceId: string }>;
    };

    expect(run.exitCode).toBe(0);
    expect(document.migrations.map((migration) => migration.spaceId)).toEqual([
      'pgvector',
      'app',
      'app',
    ]);
  });

  it.each([
    { argv: [], extensionLabelled: true },
    { argv: ['--from', '@db'], extensionLabelled: true },
    { argv: ['--from', '@empty', '--to', '@db'], extensionLabelled: false },
  ])(
    'labels @db in an extension tree only when the plan starts from its marker: $argv',
    async ({ argv, extensionLabelled }) => {
      const cwd = await buildProject();
      await addExtensionSpace(cwd);
      mocks.readAllMarkers.mockResolvedValue(
        new Map([
          ['app', { storageHash: C1, invariants: [] }],
          ['pgvector', { storageHash: EXT_C1, invariants: [] }],
        ]),
      );

      const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--show', ...argv],
        { cwd, isTty: { stdout: true } },
      );
      const graph = run.presented?.presentation.human.find((block) => block.kind === 'drawing');
      const lines = drawingLines(graph === undefined ? [] : [graph]);
      const extensionStart = lines.indexOf('pgvector:');
      const appLines = lines.slice(0, extensionStart);
      const extensionLines = lines.slice(extensionStart);

      expect(run.exitCode).toBe(0);
      expect(extensionStart).toBeGreaterThan(0);
      expect(appLines.filter((line) => line.includes('@db'))).toHaveLength(1);
      expect(extensionLines.some((line) => line.includes('@db'))).toBe(extensionLabelled);
    },
  );
});
