import { type ContractReferenceRelation, crossRef } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { diagnosticSource, type FieldSymbol, type PslDiagnostic } from '@internal/psl-parser';
import {
  consumeInvalidFkPairing,
  fkRelationPairKey,
  type InvalidFkPairing,
  requiredOneToOneBackrelationDiagnostic,
} from '@internal/psl-parser/interpret';
import type { PslSources } from '@internal/psl-parser/syntax';

/** A relation field that holds the foreign key, with its local and referenced fields as stored. */
export interface MongoForeignKeyRelation {
  readonly declaringModel: string;
  readonly targetModel: string;
  readonly relationName?: string;
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
}

/** A relation field without `fields`/`references`, which takes its keys from the matching foreign key. */
export interface MongoBackRelationCandidate {
  readonly modelName: string;
  readonly targetModelName: string;
  readonly relationName?: string;
  readonly cardinality: '1:1' | '1:N';
  readonly field: FieldSymbol;
  readonly sources: PslSources;
}

export interface PairedMongoBackRelation {
  readonly modelName: string;
  readonly fieldName: string;
  readonly relation: ContractReferenceRelation;
}

/**
 * Matches each back-relation with the foreign key on the other model: same model pair, and the same relation name when the back-relation has one. A back-relation with no match is orphaned unless its foreign key was already reported (`invalidFkPairings`); one with several matches is ambiguous.
 */
export function pairMongoBackRelations(input: {
  readonly foreignKeys: readonly MongoForeignKeyRelation[];
  readonly candidates: readonly MongoBackRelationCandidate[];
  readonly invalidFkPairings: InvalidFkPairing[];
}): { readonly relations: PairedMongoBackRelation[]; readonly diagnostics: PslDiagnostic[] } {
  const foreignKeysByPair = new Map<string, MongoForeignKeyRelation[]>();
  for (const fk of input.foreignKeys) {
    const key = fkRelationPairKey(fk.declaringModel, fk.targetModel);
    const existing = foreignKeysByPair.get(key);
    if (existing) {
      existing.push(fk);
    } else {
      foreignKeysByPair.set(key, [fk]);
    }
  }

  const relations: PairedMongoBackRelation[] = [];
  const diagnostics: PslDiagnostic[] = [];
  for (const candidate of input.candidates) {
    const { field, modelName, targetModelName } = candidate;
    const source = diagnosticSource(candidate.sources, field.node.syntax);
    const pairKey = fkRelationPairKey(targetModelName, modelName);
    const pairMatches = foreignKeysByPair.get(pairKey) ?? [];
    const matches = candidate.relationName
      ? pairMatches.filter((fk) => fk.relationName === candidate.relationName)
      : pairMatches;

    if (matches.length === 0) {
      if (consumeInvalidFkPairing(candidate, pairKey, input.invalidFkPairings)) continue;
      diagnostics.push({
        code: 'PSL_ORPHANED_BACKRELATION',
        message: `Backrelation list field "${modelName}.${field.name}" has no matching FK-side relation on model "${targetModelName}". Add @relation(fields: [...], references: [...]) on the FK-side relation or use an explicit join model for many-to-many.`,
        ...source.at(field.span),
      });
      continue;
    }
    const [fk] = matches;
    if (fk === undefined || matches.length > 1) {
      diagnostics.push({
        code: 'PSL_AMBIGUOUS_BACKRELATION',
        message: `Backrelation list field "${modelName}.${field.name}" matches multiple FK-side relations on model "${targetModelName}". Add @relation("...") to both sides to disambiguate.`,
        ...source.at(field.span),
      });
      continue;
    }

    if (candidate.cardinality === '1:1' && !field.optional) {
      diagnostics.push(
        requiredOneToOneBackrelationDiagnostic({
          modelName,
          field,
          targetModelName,
          sources: candidate.sources,
          recordNoun: 'document',
        }),
      );
    }
    relations.push({
      modelName,
      fieldName: field.name,
      relation: {
        to: crossRef(targetModelName, UNBOUND_NAMESPACE_ID),
        ...(candidate.cardinality === '1:N'
          ? { cardinality: '1:N' as const }
          : { cardinality: '1:1' as const, nullable: true }),
        on: { localFields: fk.targetFields, targetFields: fk.localFields },
      },
    });
  }
  return { relations, diagnostics };
}
