import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  buildSymbolTable,
  createPslDiagnosticCollector,
  type FieldSymbol,
} from '@internal/psl-parser';
import { type PslSources, parse } from '@internal/psl-parser/syntax';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  type ModelBackrelationCandidate,
} from '@internal/sql-contract-psl/resolution';
import { describe, expect, it } from 'vitest';
import { RELATION_PAIRING_CODES } from '../src/relations';

const candidateSources = new WeakMap<FieldSymbol, PslSources>();

function fieldSymbol(
  fieldName: string,
  targetModelName: string,
  shape: { readonly isList: boolean; readonly optional: boolean },
): FieldSymbol {
  const optional = shape.optional ? '?' : '';
  const list = shape.isList ? '[]' : '';
  const { document, sources } = parse(
    `model Test {\n  id Int @id\n  ${fieldName} ${targetModelName}${list}${optional}\n}`,
    'schema.prisma',
  );
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const field = symbolTable.topLevel.models['Test']?.fields[fieldName];
  if (field === undefined) throw new Error(`field ${fieldName} missing`);
  candidateSources.set(field, sources);
  return field;
}

function backrelation(
  modelName: string,
  fieldName: string,
  targetModelName: string,
  shape: { readonly isList: boolean; readonly optional: boolean },
): ModelBackrelationCandidate {
  return {
    modelName,
    tableName: modelName,
    field: fieldSymbol(fieldName, targetModelName, shape),
    targetModelName,
    isList: shape.isList,
  };
}

function foreignKey(
  declaringModelName: string,
  targetModelName: string,
  localColumns: readonly string[],
  referencedColumns: readonly string[],
): FkRelationMetadata {
  return {
    declaringModelName,
    declaringFieldName: targetModelName.toLowerCase(),
    declaringTableName: declaringModelName,
    targetModelName,
    targetTableName: targetModelName,
    nullable: false,
    localColumns,
    referencedColumns,
  };
}

function pairingDiagnostics(input: {
  readonly candidate: ModelBackrelationCandidate;
  readonly foreignKeys: readonly FkRelationMetadata[];
  readonly idColumns?: Readonly<Record<string, readonly string[]>>;
  readonly uniqueColumnSets?: Readonly<Record<string, readonly (readonly string[])[]>>;
}): readonly ContractSourceDiagnostic[] {
  const { modelRelations, fkRelationsByPair, fkRelationsByDeclaringModel } = indexFkRelations({
    fkRelationMetadata: input.foreignKeys,
  });
  const sources = candidateSources.get(input.candidate.field);
  if (sources === undefined) throw new Error('candidate sources missing');
  const diagnostics = createPslDiagnosticCollector(sources);
  applyBackrelationCandidates({
    backrelationCandidates: [input.candidate],
    fkRelationsByPair,
    invalidFkPairings: [],
    fkRelationsByDeclaringModel,
    modelIdColumns: new Map(Object.entries(input.idColumns ?? {})),
    modelUniqueColumnSets: new Map(Object.entries(input.uniqueColumnSets ?? {})),
    modelRelations,
    diagnostics,
    sources,
  });
  const external = diagnostics.toExternal();
  for (const diagnostic of external) {
    expect(diagnostic.sourceId).toBe('schema.prisma');
    expect(diagnostic.span).toEqual(input.candidate.field.span);
  }
  return external;
}

const list = { isList: true, optional: false };
const optionalSingle = { isList: false, optional: true };

const helperBranches: Readonly<Record<string, () => readonly ContractSourceDiagnostic[]>> = {
  'a back-relation with no foreign key': () =>
    pairingDiagnostics({ candidate: backrelation('User', 'posts', 'Post', list), foreignKeys: [] }),
  'a back-relation that matches two foreign keys': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'posts', 'Post', list),
      foreignKeys: [
        foreignKey('Post', 'User', ['authorId'], ['id']),
        foreignKey('Post', 'User', ['editorId'], ['id']),
      ],
    }),
  'a singular back-relation over a foreign key that is not unique': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'profile', 'Profile', optionalSingle),
      foreignKeys: [foreignKey('Profile', 'User', ['userId'], ['id'])],
    }),
  'a required singular back-relation': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'profile', 'Profile', { isList: false, optional: false }),
      foreignKeys: [foreignKey('Profile', 'User', ['userId'], ['id'])],
      uniqueColumnSets: { Profile: [['userId']] },
    }),
  'a junction-shaped model whose id does not cover its foreign keys': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'tags', 'Tag', list),
      foreignKeys: [
        foreignKey('UserTag', 'User', ['userId'], ['id']),
        foreignKey('UserTag', 'Tag', ['tagId'], ['id']),
      ],
      idColumns: { Tag: ['id'], UserTag: ['id'] },
    }),
  'a junction-shaped model whose foreign key misses the target id': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'tags', 'Tag', list),
      foreignKeys: [
        foreignKey('UserTag', 'User', ['userId'], ['id']),
        foreignKey('UserTag', 'Tag', ['tagName'], ['name']),
      ],
      idColumns: { Tag: ['id'], UserTag: ['userId', 'tagName'] },
    }),
  'a back-relation that matches two junction models': () =>
    pairingDiagnostics({
      candidate: backrelation('User', 'tags', 'Tag', list),
      foreignKeys: [
        foreignKey('UserTag', 'User', ['userId'], ['id']),
        foreignKey('UserTag', 'Tag', ['tagId'], ['id']),
        foreignKey('TagUser', 'User', ['userId'], ['id']),
        foreignKey('TagUser', 'Tag', ['tagId'], ['id']),
      ],
      idColumns: { Tag: ['id'], UserTag: ['userId', 'tagId'], TagUser: ['userId', 'tagId'] },
    }),
};

describe('relation pairing diagnostic codes', () => {
  it.each(Object.entries(helperBranches))('the shared helper reports %s', (_, run) => {
    expect(run()).toHaveLength(1);
  });

  it('maps every code the shared pairing helper emits, and no other code', () => {
    const emitted = new Set(
      Object.values(helperBranches).flatMap((run) => run().map((diagnostic) => diagnostic.code)),
    );
    expect([...emitted].sort()).toEqual([...RELATION_PAIRING_CODES].sort());
  });
});
