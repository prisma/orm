/**
 * Native-enum emission through the printer/document-AST layer: given hand-fed
 * `EnumInfo` definitions, `buildPslDocumentAst` emits `native_enum` blocks
 * (name transforms, `@@map`, member sanitization with explicit values) and
 * resolves enum-typed columns to `pg.enum(<Name>)` type-constructor fields.
 *
 * These tests drive the printer seams directly — independent of live
 * introspection; the infer entry (`inferPostgresPslContract`) still throws on
 * native enums until the adoption dispatch wires real data through.
 */
import type { EnumInfo, PslPrinterOptions } from '@internal/family-sql/psl-infer';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { printPsl } from '@internal/psl-printer';
import type { SqlTableIRInput } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../../../src/core/authoring';
import { parsePostgresDefault } from '../../../src/core/default-normalizer';
import { buildPslDocumentAst } from '../../../src/core/psl-infer/infer-psl-contract';
import { createPostgresDefaultMapping } from '../../../src/core/psl-infer/postgres-default-mapping';
import { createPostgresTypeMap } from '../../../src/core/psl-infer/postgres-type-map';

function enumInfoOf(definitions: Record<string, readonly string[]>): EnumInfo {
  return {
    typeNames: new Set(Object.keys(definitions)),
    definitions: new Map(Object.entries(definitions)),
  };
}

function printWithEnums(
  tables: Record<string, SqlTableIRInput>,
  definitions: Record<string, readonly string[]>,
): string {
  const enumInfo = enumInfoOf(definitions);
  const options: PslPrinterOptions = {
    typeMap: createPostgresTypeMap(enumInfo.typeNames),
    defaultMapping: createPostgresDefaultMapping(),
    parseRawDefault: parsePostgresDefault,
    enumInfo,
  };
  const ast = buildPslDocumentAst(new SqlSchemaIR({ tables }), options, {
    extraRelationsByTable: new Map(),
    crossSpaceFieldNamesByTable: new Map(),
    danglingForeignKeysByTable: new Map(),
  });
  return printPsl(ast, { pslBlockDescriptors: postgresAuthoringPslBlockDescriptors });
}

const sessionsTable: SqlTableIRInput = {
  name: 'sessions',
  columns: {
    id: { name: 'id', nativeType: 'int4', nullable: false },
    aal: { name: 'aal', nativeType: 'aal_level', nullable: true },
  },
  primaryKey: { columns: ['id'] },
  foreignKeys: [],
  uniques: [],
  indexes: [],
};

describe('native_enum block emission', () => {
  it('emits a block with @@map and declaration-ordered members (the auth.aal_level shape)', () => {
    const output = printWithEnums(
      { sessions: sessionsTable },
      { aal_level: ['aal1', 'aal2', 'aal3'] },
    );

    expect(output).toContain(
      'native_enum AalLevel {\n  aal1 = "aal1"\n  aal2 = "aal2"\n  aal3 = "aal3"\n  @@map("aal_level")\n}',
    );
  });

  it('omits @@map when the type name already is the PSL name', () => {
    const output = printWithEnums({}, { Status: ['draft', 'done'] });

    expect(output).toContain('native_enum Status {\n  draft = "draft"\n  done = "done"\n}');
    expect(output).not.toContain('@@map');
  });

  it('emits a block for an enum type no column references', () => {
    const output = printWithEnums(
      {
        user: {
          name: 'user',
          columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      { orphan_enum: ['a', 'b'] },
    );

    expect(output).toContain('native_enum OrphanEnum {');
    expect(output).toContain('@@map("orphan_enum")');
  });

  it('preserves declaration order, not alphabetical order', () => {
    const output = printWithEnums({}, { priority: ['low', 'high', 'medium'] });

    const lowAt = output.indexOf('low = "low"');
    const highAt = output.indexOf('high = "high"');
    const mediumAt = output.indexOf('medium = "medium"');
    expect(lowAt).toBeGreaterThan(-1);
    expect(lowAt).toBeLessThan(highAt);
    expect(highAt).toBeLessThan(mediumAt);
  });
});

describe('member-name sanitization with explicit values', () => {
  it('sanitizes non-identifier values while the string value carries the truth', () => {
    const output = printWithEnums({}, { ticket_priority: ['low', 'high-priority', '2nd', 'enum'] });

    expect(output).toContain('low = "low"');
    expect(output).toContain('highPriority = "high-priority"');
    expect(output).toContain('_2nd = "2nd"');
    expect(output).toContain('_enum = "enum"');
  });

  it('deduplicates sanitized member names that collide', () => {
    const output = printWithEnums({}, { weird: ['a-b', 'a b'] });

    expect(output).toContain('aB = "a-b"');
    expect(output).toContain('aB2 = "a b"');
  });

  it('escapes quotes and backslashes in member values', () => {
    const output = printWithEnums({}, { quoted: ['say "hi"', 'back\\slash'] });

    expect(output).toContain('= "say \\"hi\\""');
    expect(output).toContain('= "back\\\\slash"');
  });
});

describe('name collision against a model of the same name', () => {
  it('renames the enum away from the model and keeps @@map carrying the type name', () => {
    const output = printWithEnums(
      {
        status: {
          name: 'status',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            state: { name: 'state', nativeType: 'status', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      { status: ['open', 'closed'] },
    );

    expect(output).toContain('model Status {');
    expect(output).toContain('native_enum Status2 {');
    expect(output).toContain('@@map("status")');
    expect(output).toContain('pg.enum(Status2)');
  });
});

describe('pg.enum(Name) column emission', () => {
  it('emits the call syntax with optionality composing like any other field type', () => {
    const output = printWithEnums(
      {
        sessions: {
          ...sessionsTable,
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            aal: { name: 'aal', nativeType: 'aal_level', nullable: true },
            aal_required: { name: 'aal_required', nativeType: 'aal_level', nullable: false },
          },
        },
      },
      { aal_level: ['aal1', 'aal2'] },
    );

    expect(output).toContain('pg.enum(AalLevel)?');
    expect(output).toMatch(/aalRequired\s+pg\.enum\(AalLevel\)\s/);
  });

  it('emits the list form for an enum array column', () => {
    const output = printWithEnums(
      {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            roles: { name: 'roles', nativeType: 'user_role', nullable: false, many: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      { user_role: ['admin', 'user'] },
    );

    expect(output).toContain('pg.enum(UserRole)[]');
  });

  it('does not emit Unsupported(...) for enum-typed columns', () => {
    const output = printWithEnums(
      { sessions: sessionsTable },
      { aal_level: ['aal1', 'aal2', 'aal3'] },
    );

    expect(output).not.toContain('Unsupported(');
  });
});

describe('emitted PSL parses', () => {
  function parseDiagnostics(source: string) {
    const { document, sources } = parse(source, 'print-psl.enums.test.psl');
    const { diagnostics } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    });
    return diagnostics;
  }

  it('the @@map + sanitized-member shape parses with zero diagnostics', () => {
    const output = printWithEnums(
      { sessions: sessionsTable },
      { aal_level: ['aal1', 'aal2', 'aal3'], ticket_priority: ['low', 'high-priority', '2nd'] },
    );

    expect(parseDiagnostics(output)).toEqual([]);
  });

  it('the model-collision + array shape parses with zero diagnostics', () => {
    const output = printWithEnums(
      {
        status: {
          name: 'status',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            state: { name: 'state', nativeType: 'status', nullable: false },
            history: { name: 'history', nativeType: 'status', nullable: false, many: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      { status: ['open', 'closed'] },
    );

    expect(parseDiagnostics(output)).toEqual([]);
  });
});
