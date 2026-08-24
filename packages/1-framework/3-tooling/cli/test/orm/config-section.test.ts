import { describe, expect, it } from 'vitest';
import { ormConfigSection } from '../../src/orm/config-section';

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
    it('validates and hands the value through untouched', () => {
      const raw = validConfig();
      const result = ormConfigSection.validate(raw);

      expect(result).toEqual({ ok: true, value: raw, diagnostics: [] });
    });

    it('accepts the optional subsections', () => {
      const raw = {
        ...validConfig(),
        migrations: { dir: 'migrations' },
        formatter: { indent: 2, newline: 'LF' },
        db: { connection: 'postgres://localhost/app' },
      };

      expect(ormConfigSection.validate(raw).ok).toBe(true);
    });
  });

  describe('absence', () => {
    it('reports the missing config file rather than throwing', () => {
      const result = ormConfigSection.validate(undefined);

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
      const result = ormConfigSection.validate(raw);

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
      const result = ormConfigSection.validate({ migrations: { dir: 42 } });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'family',
        'target',
        'adapter',
        'migrations.dir',
      ]);
    });

    it('reports an emitted artifact listed as a contract input', () => {
      const result = ormConfigSection.validate({
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['/app/contract.json'], load: () => ({}) },
          output: '/app/contract.json',
        },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'contract.source.inputs[]',
      ]);
    });

    it('reports the collision when the input spells the same file differently', () => {
      const result = ormConfigSection.validate({
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['./out/./contract.json'], load: () => ({}) },
          output: 'out/contract.json',
        },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.meta?.['field'])).toEqual([
        'contract.source.inputs[]',
      ]);
    });

    it('does not report a collision for a genuinely different file', () => {
      const result = ormConfigSection.validate({
        ...validConfig(),
        contract: {
          source: { format: 'psl', inputs: ['./src/contract.prisma'], load: () => ({}) },
          output: 'out/contract.json',
        },
      });

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
      const result = ormConfigSection.validate(raw);

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
      expect(() => ormConfigSection.validate(raw)).not.toThrow();
    });

    it('never throws when a descriptor getter explodes', () => {
      const raw = {
        ...validConfig(),
        get extensions(): never {
          throw new Error('boom');
        },
      };

      expect(() => ormConfigSection.validate(raw)).not.toThrow();
      expect(ormConfigSection.validate(raw).ok).toBe(false);
    });
  });
});
