import type { ContractMarkerRecord } from '@internal/contract/types';
import { parseMarkerRowSafely } from '@internal/errors/execution';
import { type } from 'arktype';
import { mongoAdapterError } from './errors';

export const COLLECTION = '_prisma_migrations';
export const MONGO_MARKER_COLLECTION = COLLECTION;
export const MONGO_LEDGER_COLLECTION = `_prisma_migrations ledger documents in ${COLLECTION}`;

const MongoMarkerDocSchema = type({
  space: 'string',
  storageHash: 'string',
  profileHash: 'string',
  'contractJson?': 'unknown | null',
  'canonicalVersion?': 'number | null',
  'updatedAt?': 'Date',
  'appTag?': 'string | null',
  'meta?': type({ '[string]': 'unknown' }).or('null'),
  'invariants?': type('string').array(),
  '+': 'delete',
});

export function parseMongoMarkerDoc(doc: unknown): ContractMarkerRecord {
  const result = MongoMarkerDocSchema(doc);
  if (result instanceof type.errors) {
    throw mongoAdapterError(
      'CONTRACT.MARKER_ROW_CORRUPT',
      `Invalid marker doc on ${COLLECTION}: ${result.summary}`,
      { meta: { collection: COLLECTION, detail: result.summary } },
    );
  }
  return {
    storageHash: result.storageHash,
    profileHash: result.profileHash,
    contractJson: result.contractJson ?? null,
    canonicalVersion: result.canonicalVersion ?? null,
    updatedAt: result.updatedAt ?? new Date(),
    appTag: result.appTag ?? null,
    meta: result.meta ?? {},
    invariants: result.invariants ?? [],
  };
}

export function parseMongoMarkerDocSafely(doc: unknown, space: string): ContractMarkerRecord {
  return parseMarkerRowSafely(doc, parseMongoMarkerDoc, {
    space,
    markerLocation: MONGO_MARKER_COLLECTION,
  });
}
