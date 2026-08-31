import type { SectionProvenance } from '@prisma/cli-engine';
import { ok } from '@prisma/cli-engine/protocol';
import { createTestCli } from '@prisma/cli-engine/testing';
import { describe, expect, it } from 'vitest';
import { ormConfigSection } from '../../src/orm/config-section';
import { defineOrmCommand } from '../../src/orm/define-command';

const CONFIG_FILE = '/repo/packages/db/prisma.config.ts';

function provenanceFor(
  raw: Record<string, unknown>,
  file: string = CONFIG_FILE,
): SectionProvenance {
  return {
    files: [file],
    keys: Object.fromEntries(Object.keys(raw).map((key) => [key, file])),
  };
}

const HOSTILE_PROVENANCE: SectionProvenance = { files: [CONFIG_FILE], keys: {} };

function validFamily() {
  return {
    kind: 'family',
    id: 'sql',
    familyId: 'sql',
    version: '1.0.0',
    emission: {},
    create: () => ({}),
  };
}

function validDescriptor(kind: string) {
  return {
    kind,
    id: `${kind}-id`,
    familyId: 'sql',
    targetId: 'postgres',
    version: '1.0.0',
    create: () => ({}),
  };
}

function validConfig() {
  return {
    family: validFamily(),
    target: { ...validDescriptor('target'), targetId: 'postgres' },
    adapter: validDescriptor('adapter'),
  };
}

describe('ormConfigSection', () => {
  it('is named orm', () => {
    expect(ormConfigSection.name).toBe('orm');
  });

  describe('a structurally valid section', () => {
    it('validates and defaults migrations.dir beside the declaring file', () => {
      const raw = validConfig();
      const result = ormConfigSection.validate(raw, provenanceFor(raw));

      expect(result).toEqual({
        ok: true,
        value: { ...raw, migrations: { dir: '/repo/packages/db/migrations' } },
        diagnostics: [],
      });
    });

    it('accepts the optional subsections', () => {
      const raw = {
        ...validConfig(),
        migrations: { dir: 'migrations' },
        formatter: { indent: 2, newline: 'LF' },
        db: { connection: 'postgres://localhost/app' },
      };

      expect(ormConfigSection.validate(raw, provenanceFor(raw)).ok).toBe(true);
    });
  });

  describe('absence', () => {
    it('reports the missing config file rather than throwing', () => {
      const result = ormConfigSection.validate(undefined, { files: [], keys: {} });

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            code: 'CONFIG.FILE_NOT_FOUND',
            severity: 'error',
            summary: 'No Prisma Next configuration was loaded',
            why: 'The orm config section is absent, so prisma.config.ts was never evaluated.',
            nextActions: [
              {
                kind: 'run-command',
                label: 'Create a config file',
                command: '{bin} orm init',
              },
            ],
          },
        ],
      });
    });
  });

  describe('whole-section blocking', () => {
    it('fails the whole section when one subsection is malformed', () => {
      const raw = { ...validConfig(), migrations: { dir: 42 } };
      const result = ormConfigSection.validate(raw, provenanceFor(raw));

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        {
          code: 'CONFIG.VALIDATION_FAILED',
          severity: 'error',
          summary: 'Config.migrations.dir must be a string',
          why: 'Config.migrations.dir must be a string',
          nextActions: [
            {
              kind: 'edit-file',
              label: 'Correct migrations.dir in prisma.config.ts',
            },
          ],
          meta: { field: 'migrations.dir', section: 'migrations' },
        },
      ]);
    });

    it('reports every issue it found, not just the first', () => {
      const result = ormConfigSection.validate({ migrations: { dir: 42 } }, HOSTILE_PROVENANCE);

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'family',
        'target',
        'adapter',
        'migrations.dir',
      ]);
    });

    it('reports an emitted artifact listed as a contract input', () => {
      const raw = {
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['/app/contract.json'], load: () => ({}) },
          output: '/app/contract.json',
        },
      };
      const result = ormConfigSection.validate(raw, provenanceFor(raw));

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'contract.source.inputs[]',
      ]);
    });

    it('reports the collision when the input spells the same file differently', () => {
      const raw = {
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['./out/./contract.json'], load: () => ({}) },
          output: 'out/contract.json',
        },
      };
      const result = ormConfigSection.validate(raw, provenanceFor(raw));

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'contract.source.inputs[]',
      ]);
    });

    it('does not report a collision for a genuinely different file', () => {
      const raw = {
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['./src/contract.prisma'], load: () => ({}) },
          output: 'out/contract.json',
        },
      };
      const result = ormConfigSection.validate(raw, provenanceFor(raw));

      expect(result.ok).toBe(true);
    });
  });

  describe('hostile input', () => {
    it.each([
      ['null', null],
      ['a string', 'prisma.config.ts'],
      ['a number', 7],
      ['a boolean', true],
      ['an array', []],
      ['a function', () => undefined],
    ])('rejects %s without throwing', (_label, raw) => {
      const result = ormConfigSection.validate(raw, HOSTILE_PROVENANCE);

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        {
          code: 'CONFIG.VALIDATION_FAILED',
          severity: 'error',
          summary: 'Prisma Next configuration must be an object',
          why: 'The orm config section is not an object, so no section can be read from it.',
          nextActions: [
            {
              kind: 'edit-file',
              label: 'Export a configuration object from prisma.config.ts',
            },
          ],
        },
      ]);
    });

    it.each([
      ['a config whose subsections are all wrong types', { family: 1, target: 'x', adapter: [] }],
      ['a prototype-polluted object', JSON.parse('{"__proto__": {"family": 1}}')],
      [
        'an object with a throwing getter on an unread key',
        {
          get unrelated() {
            throw new Error('boom');
          },
          ...validConfig(),
        },
      ],
      ['deeply nested garbage', { family: { kind: { kind: { kind: {} } } } }],
    ])('never throws on %s', (_label, raw) => {
      expect(() => ormConfigSection.validate(raw, HOSTILE_PROVENANCE)).not.toThrow();
    });

    it('never throws when a descriptor getter explodes', () => {
      const raw = {
        ...validConfig(),
        get extensions(): never {
          throw new Error('boom');
        },
      };

      expect(() => ormConfigSection.validate(raw, HOSTILE_PROVENANCE)).not.toThrow();
      expect(ormConfigSection.validate(raw, HOSTILE_PROVENANCE).ok).toBe(false);
    });
  });

  describe('declaring-file path resolution', () => {
    function contractSection(inputs: readonly string[], output: string) {
      return { source: { format: 'psl', inputs: [...inputs], load: () => ({}) }, output };
    }

    function validatedValue(raw: Record<string, unknown>, provenance: SectionProvenance) {
      const result = ormConfigSection.validate(raw, provenance);
      if (!result.ok) {
        throw new Error(`expected ok, got ${JSON.stringify(result.diagnostics)}`);
      }
      return result.value;
    }

    it('resolves contract paths against the file that declared the contract key', () => {
      const raw = {
        ...validConfig(),
        contract: contractSection(['./src/schema.psl'], './out/contract.json'),
      };

      const value = validatedValue(raw, provenanceFor(raw));

      expect(value.contract?.source.inputs).toEqual(['/repo/packages/db/src/schema.psl']);
      expect(value.contract?.output).toBe('/repo/packages/db/out/contract.json');
    });

    it('resolves migrations.dir against the file that declared the migrations key', () => {
      const raw = { ...validConfig(), migrations: { dir: './db/migrations' } };

      const value = validatedValue(raw, provenanceFor(raw));

      expect(value.migrations?.dir).toBe('/repo/packages/db/db/migrations');
    });

    it('resolves each key against its own declaring file when files differ', () => {
      const raw = {
        ...validConfig(),
        contract: contractSection(['./schema.psl'], './contract.json'),
        migrations: { dir: './migrations' },
      };
      const provenance: SectionProvenance = {
        files: ['/repo/packages/db/prisma.config.ts', '/repo/prisma.config.ts'],
        keys: {
          ...provenanceFor(raw, '/repo/packages/db/prisma.config.ts').keys,
          migrations: '/repo/prisma.config.ts',
        },
      };

      const value = validatedValue(raw, provenance);

      expect(value.contract?.output).toBe('/repo/packages/db/contract.json');
      expect(value.migrations?.dir).toBe('/repo/migrations');
    });

    it('defaults migrations.dir beside the nearest declaring file when no file sets it', () => {
      const raw = validConfig();
      const provenance = provenanceFor(raw, '/repo/packages/db/prisma.config.ts');

      expect(validatedValue(raw, provenance).migrations?.dir).toBe('/repo/packages/db/migrations');
    });

    it('defaults contract.output beside the file that declared the contract key', () => {
      const raw = { ...validConfig(), contract: { source: contractSection([], 'x').source } };

      expect(validatedValue(raw, provenanceFor(raw)).contract?.output).toBe(
        '/repo/packages/db/src/prisma/contract.json',
      );
    });

    it('passes absolute paths through unchanged', () => {
      const raw = {
        ...validConfig(),
        contract: contractSection(['/abs/schema.psl'], '/abs/out/contract.json'),
        migrations: { dir: '/abs/migrations' },
      };

      const value = validatedValue(raw, provenanceFor(raw));

      expect(value.contract?.source.inputs).toEqual(['/abs/schema.psl']);
      expect(value.contract?.output).toBe('/abs/out/contract.json');
      expect(value.migrations?.dir).toBe('/abs/migrations');
    });
  });
});

describe('the config an ORM command handler receives', () => {
  it('carries paths under the declaring config file, whatever directory the command ran in', async () => {
    const configDir = '/repo/packages/db';
    let seen: { output?: string | undefined; dir?: string | undefined } = {};
    const cli = createTestCli({
      commands: {
        probe: defineOrmCommand({
          help: { summary: 'Records the config paths the handler receives' },
          needs: { config: ormConfigSection },
          handler: async (_args, ctx) => {
            seen = { output: ctx.config.contract?.output, dir: ctx.config.migrations?.dir };
            return ok(
              ctx.present(
                { data: seen, exitCode: 0 },
                { stdout: () => [], next: () => [], human: () => [], json: () => seen },
              ),
            );
          },
        }),
      },
      loadConfig: () =>
        Promise.resolve({
          files: [
            {
              path: `${configDir}/prisma.config.ts`,
              sections: {
                orm: {
                  ...validConfig(),
                  contract: {
                    source: { format: 'psl', inputs: ['./schema.psl'], load: () => ({}) },
                    output: './out/contract.json',
                  },
                  migrations: { dir: './migrations' },
                },
              },
            },
          ],
          diagnostics: [],
        }),
    });

    const run = await cli.run(['probe', '--json'], { cwd: process.cwd() });

    expect(run.exitCode).toBe(0);
    expect(seen).toEqual({
      output: `${configDir}/out/contract.json`,
      dir: `${configDir}/migrations`,
    });
  });
});
