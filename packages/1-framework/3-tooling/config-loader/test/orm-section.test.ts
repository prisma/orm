import type { SectionProvenance } from '@prisma/cli-engine';
import { describe, expect, it } from 'vitest';
import {
  descriptorRelationshipProblems,
  ormConfigSection,
  validateOrmSection,
} from '../src/orm-section';

const FILE = '/project/prisma.config.ts';

function provenanceFor(raw: Record<string, unknown>): SectionProvenance {
  return { files: [FILE], keys: Object.fromEntries(Object.keys(raw).map((key) => [key, FILE])) };
}

const descriptorBase = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...descriptorBase, kind: 'target', id: 'postgres' },
    adapter: { ...descriptorBase, kind: 'adapter', id: 'pg' },
    ...overrides,
  };
}

function fields(raw: Record<string, unknown>): readonly string[] {
  const result = validateOrmSection(raw, provenanceFor(raw));
  return result.ok
    ? []
    : result.diagnostics.map((diagnostic) => String(diagnostic.meta?.['field']));
}

describe('the orm section', () => {
  it('is the section the commands declare', () => {
    expect(ormConfigSection.name).toBe('orm');
  });

  it('supplies the default contract output next to the default source directory', () => {
    const raw = validRaw({ contract: { source: { load: () => ({}) } } });

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value.contract?.output).toBe('/project/src/prisma/contract.json');
  });

  it('accepts a valid config, supplies the migrations dir, and records baseDir', () => {
    const raw = validRaw();

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value).toMatchObject({
      target: { targetId: 'postgres' },
      migrations: { dir: '/project/migrations' },
      baseDir: '/project',
    });
  });

  it('resolves contract inputs, output and migrations dir against the config file', () => {
    const raw = validRaw({
      contract: {
        source: { format: 'psl', inputs: ['./schema.prisma'], load: () => ({}) },
        output: 'out/contract.json',
      },
      migrations: { dir: './db' },
    });

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value).toMatchObject({
      contract: {
        source: { inputs: ['/project/schema.prisma'] },
        output: '/project/out/contract.json',
      },
      migrations: { dir: '/project/db' },
    });
  });

  it('resolves glob pattern inputs against the config file and keeps the pattern', () => {
    const raw = validRaw({
      contract: {
        source: { load: () => ({}), inputs: ['./prisma/**/*.prisma', './extra.prisma'] },
      },
    });

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value.contract?.source.inputs).toEqual([
      '/project/prisma/**/*.prisma',
      '/project/extra.prisma',
    ]);
  });

  it('leaves an absolute path alone', () => {
    const raw = validRaw({ migrations: { dir: '/elsewhere/db' } });

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value.migrations?.dir).toBe('/elsewhere/db');
  });

  it('reports each missing descriptor under its own field', () => {
    expect(fields({})).toEqual(['adapter', 'family', 'target']);
  });

  it('reports descriptor field problems', () => {
    expect(fields(validRaw({ family: { kind: 'family' } }))).toEqual([
      'family.create',
      'family.emission',
      'family.familyId',
      'family.id',
      'family.version',
    ]);
  });

  it('reports a family mismatch on the target', () => {
    expect(
      fields(
        validRaw({ target: { ...descriptorBase, kind: 'target', id: 'x', familyId: 'mongo' } }),
      ),
    ).toEqual(['target.familyId']);
  });

  it('reports adapter, driver and extension mismatches against the target', () => {
    expect(
      fields(
        validRaw({ adapter: { ...descriptorBase, kind: 'adapter', id: 'pg', targetId: 'mysql' } }),
      ),
    ).toEqual(['adapter.targetId']);
    expect(
      fields(
        validRaw({ driver: { ...descriptorBase, kind: 'driver', id: 'd', familyId: 'mongo' } }),
      ),
    ).toEqual(['driver.familyId']);
    expect(
      fields(
        validRaw({
          extensions: [
            { ...descriptorBase, kind: 'extension', id: 'e' },
            { ...descriptorBase, kind: 'extension', id: 'f', targetId: 'mysql' },
          ],
        }),
      ),
    ).toEqual(['extensions.1.targetId']);
  });

  it('checks a relationship only between subsections the caller accepts', () => {
    const mismatched = { familyId: 'mongo', targetId: 'mysql' };
    const config = {
      family: { familyId: 'sql' },
      target: { familyId: 'sql', targetId: 'postgres' },
      driver: mismatched,
      extensions: [mismatched],
    };

    expect(descriptorRelationshipProblems(config, () => true).map((p) => p.path)).toEqual([
      ['driver', 'familyId'],
      ['driver', 'targetId'],
      ['extensions', 0, 'familyId'],
      ['extensions', 0, 'targetId'],
    ]);
    expect(
      descriptorRelationshipProblems(
        config,
        (section) => section !== 'driver' && section !== 'extensions',
      ),
    ).toEqual([]);
  });

  it('reports the removed extensionPacks key', () => {
    expect(fields(validRaw({ extensionPacks: [] }))).toEqual(['extensionPacks']);
  });

  it('reports contract problems under contract fields', () => {
    expect(
      fields(validRaw({ contract: { source: { inputs: ['a', 1], load: () => ({}) }, output: 3 } })),
    ).toEqual(['contract.source.inputs.1', 'contract.output']);
    expect(fields(validRaw({ contract: {} }))).toEqual(['contract.source']);
  });

  it('reports migrations and formatter problems', () => {
    expect(fields(validRaw({ migrations: { dir: 42 } }))).toEqual(['migrations.dir']);
    expect(fields(validRaw({ formatter: { indent: 0, newline: 'CR' } }))).toEqual([
      'formatter.indent',
      'formatter.newline',
    ]);
    expect(fields(validRaw({ formatter: { indent: 'tab', newline: 'LF' } }))).toEqual([]);
  });

  it('keeps every descriptor and the connection as the config file built them', () => {
    class Serializer {
      deserializeContract(json: unknown): unknown {
        return json;
      }
    }
    const target = {
      ...descriptorBase,
      kind: 'target',
      id: 'postgres',
      contractSerializer: new Serializer(),
      create() {
        return this.id;
      },
    };
    const source = { format: 'psl', inputs: ['./schema.prisma'], load: () => ({}) };
    const connection = { pool: new Serializer() };
    const raw = validRaw({ target, contract: { source }, db: { connection } });

    const result = validateOrmSection(raw, provenanceFor(raw));

    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.value.target).toBe(target);
    expect(result.value.family).toBe(raw['family']);
    expect(result.value.adapter).toBe(raw['adapter']);
    expect(result.value.db?.connection).toBe(connection);
    expect((result.value.target as unknown as typeof target).create()).toBe('postgres');
    expect(result.value.contract?.source.load).toBe(source.load);
    expect(result.value.contract?.source.inputs).toEqual(['/project/schema.prisma']);
  });

  it('keeps fields the schema does not name, on descriptors and on the contract source', () => {
    const raw = validRaw({
      family: { ...(validRaw()['family'] as object), manifest: { note: 1 } },
      contract: { source: { load: () => ({}), dialect: 'sql' } },
    });

    const result = validateOrmSection(raw, provenanceFor(raw));

    expect(result.ok && result.value).toMatchObject({
      family: { manifest: { note: 1 } },
      contract: { source: { dialect: 'sql' } },
    });
  });

  it('never throws on hostile input', () => {
    for (const raw of [
      null,
      7,
      [],
      { family: 1 },
      {
        get family() {
          throw new Error('boom');
        },
      },
    ]) {
      expect(() => validateOrmSection(raw, { files: [FILE], keys: {} })).not.toThrow();
    }
  });
});
