import { rm } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
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
  UNKNOWN,
  writePkg,
} from './fixtures/migrate-show-project';

afterEach(removeMigrateShowProjects);
beforeEach(resetMigrateShowMocks);

describe('migrate --show', () => {
  it('shows nothing to run when the from-state is already the target', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', C2.slice(7, 13), '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ ok: true, migrations: [] });
  });

  it('errors when no path leads from the from-state to the target', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', C2.slice(7, 13), '--to', C1.slice(7, 13), '--json'],
      { cwd },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({ kind: 'result', envelope: { ok: false } });
  });

  it('requires a connection when --from is omitted and the live marker must be read', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { db: undefined })).run(
      ['db', 'migrate', '--show', '--json'],
      { cwd },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.DB_CONNECTION_REQUIRED',
          why: expect.stringContaining('db migrate --show'),
        },
      },
    });
  });

  it('requires a connection for --from @db and repeats --from @db in the retry', async () => {
    const cwd = await buildProject();

    const run = await harness(ormConfig(cwd, { db: undefined })).run(
      ['db', 'migrate', '--show', '--from', '@db', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.DB_CONNECTION_REQUIRED',
          meta: { missingFlags: ['--db'] },
          nextActions: [
            expect.objectContaining({
              label: expect.stringContaining('db migrate --show --from @db --db $DATABASE_URL'),
            }),
          ],
        },
      },
    });
  });

  it('previews a ref target whose invariants ride the ref, not the contract head', async () => {
    const cwd = await buildProject();
    await writeRef(join(cwd, 'migrations', 'app', 'refs'), 'prod', {
      hash: C2,
      invariants: ['inv-a'],
    });
    const appDir = join(cwd, 'migrations', 'app');
    await rm(join(appDir, `20260101_100000_${C1.slice(7, 13)}`), { recursive: true });
    await writePkg(appDir, {
      from: EMPTY,
      to: C1,
      providedInvariants: ['inv-a'],
      createdAt: '2026-01-01T10:00:00.000Z',
    });

    const run = await harness(ormConfig(cwd)).run(
      ['db', 'migrate', '--show', '--from', EMPTY, '--to', 'prod', '--json'],
      { cwd },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      migrations: [
        expect.objectContaining({ from: EMPTY, to: C1 }),
        expect.objectContaining({ from: C1, to: C2 }),
      ],
    });
  });

  describe('the @contract marker', () => {
    it('marks the working contract, not the --to target', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', EMPTY, '--to', C1.slice(7, 13)],
        { cwd, isTty: { stdout: true } },
      );
      const lines = drawingLines(run.presented?.presentation.human ?? []);
      const contractLines = lines.filter((line) => line.includes('@contract'));

      expect(run.exitCode).toBe(0);
      expect(contractLines).toHaveLength(1);
      expect(contractLines[0]).toContain(C2.slice(7, 13));
      expect(contractLines[0]).not.toContain(C1.slice(7, 13));
    });

    it('never appears in extension spaces', async () => {
      const cwd = await buildProject();
      await addExtensionSpace(cwd);

      const run = await harness(ormConfig(cwd, { extensions: [pgvectorExtension()] })).run(
        ['db', 'migrate', '--show', '--from', EMPTY],
        { cwd, isTty: { stdout: true } },
      );
      const lines = drawingLines(run.presented?.presentation.human ?? []);

      expect(run.exitCode).toBe(0);
      const contractLines = lines.filter((line) => line.includes('@contract'));
      expect(contractLines).toHaveLength(1);
      expect(contractLines[0]).not.toContain(EXT_C1.slice(7, 13));
    });
  });

  describe('the @db marker', () => {
    it('resolves --to @db to the live marker', async () => {
      const cwd = await buildProject();
      mocks.readAllMarkers.mockResolvedValue(
        new Map([['app', { storageHash: C1, invariants: [] }]]),
      );

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', EMPTY, '--to', '@db', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toEqual({
        ok: true,
        migrations: [expect.objectContaining({ from: EMPTY, to: C1 })],
        summary: '1 migration will run',
      });
    });

    it('shows nothing to run for --to @db when the from-state is the live marker too', async () => {
      const cwd = await buildProject();
      mocks.readAllMarkers.mockResolvedValue(
        new Map([['app', { storageHash: C1, invariants: [] }]]),
      );

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--to', '@db', '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ ok: true, migrations: [] });
    });

    it('labels the target @db for --from @empty --to @db', async () => {
      const cwd = await buildProject();
      mocks.readAllMarkers.mockResolvedValue(
        new Map([['app', { storageHash: C1, invariants: [] }]]),
      );

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', '@empty', '--to', '@db'],
        { cwd, isTty: { stdout: true } },
      );
      const dbLines = drawingLines(run.presented?.presentation.human ?? []).filter((line) =>
        line.includes('@db'),
      );

      expect(run.exitCode).toBe(0);
      expect(dbLines).toHaveLength(1);
      expect(dbLines[0]).toContain(C1.slice(0, 7));
    });

    it.each([
      { argv: [] },
      { argv: ['--to', '@db'] },
      { argv: ['--from', '@empty', '--to', '@db'] },
    ])('refuses a marker outside the migration graph: $argv', async ({ argv }) => {
      const cwd = await buildProject();
      mocks.readAllMarkers.mockResolvedValue(
        new Map([['app', { storageHash: UNKNOWN, invariants: [] }]]),
      );

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', ...argv, '--json'],
        { cwd },
      );

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: false, error: { code: 'MIGRATION.MARKER_MISMATCH' } },
      });
    });

    it.each([
      { argv: ['--from', '@db'], named: true },
      { argv: ['--from', EMPTY, '--to', '@db'], named: true },
      { argv: ['--from', EMPTY], named: false },
    ])(
      'names the database in the header only when the preview reads it: $argv',
      async ({ argv, named }) => {
        const cwd = await buildProject();
        mocks.readAllMarkers.mockResolvedValue(
          new Map([['app', { storageHash: C1, invariants: [] }]]),
        );

        const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', ...argv], {
          cwd,
          isTty: { stdout: true },
        });
        const header = run.presented?.presentation.human.find((block) => block.kind === 'fields');
        const labels = header?.kind === 'fields' ? header.rows.map((row) => row.label) : [];

        expect(labels.includes('database')).toBe(named);
      },
    );

    it('errors structurally for --to @db without a connection', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd, { db: undefined })).run(
        ['db', 'migrate', '--show', '--from', EMPTY, '--to', '@db', '--json'],
        { cwd },
      );

      expect(run.exitCode).not.toBe(0);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: {
          ok: false,
          error: {
            code: 'CONFIG.DB_CONNECTION_REQUIRED',
            meta: { missingFlags: ['--db'] },
            nextActions: [
              expect.objectContaining({
                label: expect.stringContaining(
                  `db migrate --show --from ${EMPTY} --to @db --db $DATABASE_URL`,
                ),
              }),
            ],
          },
        },
      });
    });
  });

  describe('extension spaces', () => {
    it('plans extensions from their own state, never from the app --from hash', async () => {
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
  });

  describe('the preview', () => {
    it('previews the route without applying anything', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', '--json'], {
        cwd,
      });

      expect(run.exitCode).toBe(0);
      expect(mocks.migrate).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({
        ok: true,
        migrations: [
          expect.objectContaining({ spaceId: 'app', from: EMPTY, to: C1 }),
          expect.objectContaining({ spaceId: 'app', from: C1, to: C2 }),
        ],
      });
    });

    it('keeps the human-only rendering out of the result document', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show', '--json'], {
        cwd,
      });

      expect(Object.keys(run.presented?.data ?? {}).sort()).toEqual([
        'migrations',
        'ok',
        'summary',
      ]);
    });

    it('ships the topology as a drawing whose spans carry tone', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];
      const drawings = blocks.filter((block) => block.kind === 'drawing');

      expect(blocks[0]).toMatchObject({ kind: 'fields', rail: true });
      expect(drawings).toHaveLength(2);
      expect(JSON.stringify(drawings)).not.toContain('\\u001b');
      expect(JSON.stringify(drawings)).toContain('"tone"');
    });

    it('announces how many migrations will run', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.human).toContainEqual({
        kind: 'summary',
        status: 'info',
        text: 'The following 2 migrations will run:',
      });
    });

    it('keeps every arrow in the run list in one column', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(['db', 'migrate', '--show'], {
        cwd,
        isTty: { stdout: true, stderr: true },
      });
      const rendered = stripAnsi(run.stderr).split('\n');
      const runList = rendered.slice(rendered.findIndex((line) => line.includes('will run:')) + 1);
      const arrowColumns = new Set(
        runList.filter((line) => line.includes('\u2192')).map((line) => line.indexOf('\u2192')),
      );

      expect(run.stdout).toBe('');
      expect(runList.filter((line) => line.includes('\u2192'))).toHaveLength(2);
      expect(arrowColumns.size).toBe(1);
    });

    it('plans offline when --from names a contract', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', C1, '--json'],
        {
          cwd,
        },
      );

      expect(run.exitCode).toBe(0);
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({
        migrations: [expect.objectContaining({ from: C1, to: C2 })],
      });
    });

    it('names the from-state and the target in the header', async () => {
      const cwd = await buildProject();

      const run = await harness(ormConfig(cwd)).run(
        ['db', 'migrate', '--show', '--from', C1, '--to', C2],
        {
          cwd,
          isTty: { stdout: true },
        },
      );

      expect(run.presented?.presentation.human[0]).toEqual({
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: 'migrations' },
          { label: 'from', value: C1 },
          { label: 'to', value: C2 },
        ],
      });
    });
  });
});
