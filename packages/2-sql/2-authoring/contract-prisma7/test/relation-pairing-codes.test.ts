import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { FieldSymbol } from '@internal/psl-parser';
import {
  applyBackrelationCandidates,
  type FkRelationMetadata,
  indexFkRelations,
  type ModelBackrelationCandidate,
} from '@internal/sql-contract-psl/resolution';
import { describe, expect, it } from 'vitest';
import { RELATION_PAIRING_CODES } from '../src/relations';

const span = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function backrelation(
  modelName: string,
  fieldName: string,
  targetModelName: string,
  shape: { readonly isList: boolean; readonly optional: boolean },
): ModelBackrelationCandidate {
  return {
    modelName,
    tableName: modelName,
    field: { name: fieldName, optional: shape.optional, span } as FieldSymbol,
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
  const diagnostics: ContractSourceDiagnostic[] = [];
  applyBackrelationCandidates({
    backrelationCandidates: [input.candidate],
    fkRelationsByPair,
    invalidFkPairings: [],
    fkRelationsByDeclaringModel,
    modelIdColumns: new Map(Object.entries(input.idColumns ?? {})),
    modelUniqueColumnSets: new Map(Object.entries(input.uniqueColumnSets ?? {})),
    modelRelations,
    diagnostics,
    sourceId: 'schema.prisma',
  });
  return diagnostics;
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
