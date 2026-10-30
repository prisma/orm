import type { ControlPolicy } from '@internal/contract/types';
import type { SchemaDiffIssue, VerifierOutcome } from '@internal/framework-components/control';
import { canonicalize, indexLookupKey } from '@internal/mongo-contract';
import {
  deepEqual,
  type MongoSchemaCollection,
  type MongoSchemaIndex,
  type MongoSchemaIR,
} from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';
import { verifierDisposition } from './schema-verify/verifier-disposition';

/**
 * The Mongo schema diff, issue-only: `failures` carry the verdict (a verify
 * passes exactly when it is empty), `warnings` the surviving warn-graded
 * findings (live-only extras in non-strict mode, `observed` subjects).
 *
 * Each issue's `path` carries the coordinate — `[collectionName]` for a
 * whole-collection finding, `[collectionName, 'index:…' | 'validator' |
 * 'options']` for an auxiliary — and `expected`/`actual` carry the real
 * Mongo schema-IR node the finding concerns.
 */
export interface MongoSchemaDiff {
  readonly failures: readonly SchemaDiffIssue[];
  readonly warnings: readonly SchemaDiffIssue[];
}

/**
 * Reconciles a control-policy disposition with the Mongo family's strict-mode
 * contract for live-only extras — the single point where `strict` and the
 * control policy meet.
 *
 * The control policy decides first; only a `fail` is reconciled against the
 * caller's base outcome. Call sites grade a live-only extra with
 * `strict ? 'fail' : 'warn'` and a declared missing/mismatch with `fail`, so
 * this one step encodes the whole matrix:
 *
 * | live-vs-declared                    | strict   | non-strict |
 * |-------------------------------------|----------|------------|
 * | declared missing / mismatch         | fail     | fail       |
 * | live-only extra (managed/tolerated) | fail     | warn       |
 * | live-only extra (external)          | suppress (extras ignored, both modes) |
 * | anything (observed)                 | warn (both modes)     |
 *
 * `tolerated` does not diverge from `managed` on a non-strict extra index:
 * both soften to `warn`, because the softening comes from the base outcome the
 * caller already computed from `strict`, not from per-policy special-casing.
 */
function emitMongoIssueUnderControlPolicy(
  controlPolicy: ControlPolicy,
  issue: SchemaDiffIssue,
  baseOutcome: 'fail' | 'warn',
  failures: SchemaDiffIssue[],
  warnings: SchemaDiffIssue[],
): VerifierOutcome {
  const disposition = verifierDisposition(controlPolicy, issue);
  const outcome = disposition === 'fail' ? baseOutcome : disposition;
  if (outcome === 'suppress') {
    return 'suppress';
  }
  if (outcome === 'warn') {
    warnings.push(issue);
  } else {
    failures.push(issue);
  }
  return outcome;
}

export function diffMongoSchemas(
  live: MongoSchemaIR,
  expected: MongoSchemaIR,
  strict: boolean,
  collectionControlPolicy: (collectionName: string) => ControlPolicy,
): MongoSchemaDiff {
  const failures: SchemaDiffIssue[] = [];
  const warnings: SchemaDiffIssue[] = [];

  const allNames = new Set([...live.collectionNames, ...expected.collectionNames]);

  for (const name of [...allNames].sort()) {
    const liveColl = live.collection(name);
    const expectedColl = expected.collection(name);

    if (!liveColl && expectedColl) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy(name),
        {
          path: [name],
          expected: expectedColl,
        },
        'fail',
        failures,
        warnings,
      );
      continue;
    }

    if (liveColl && !expectedColl) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy(name),
        {
          path: [name],
          actual: liveColl,
        },
        strict ? 'fail' : 'warn',
        failures,
        warnings,
      );
      continue;
    }

    const lc = liveColl as MongoSchemaCollection;
    const ec = expectedColl as MongoSchemaCollection;
    const controlPolicy = collectionControlPolicy(name);
    diffIndexes(name, lc, ec, strict, controlPolicy, failures, warnings);
    diffValidator(name, lc, ec, strict, controlPolicy, failures, warnings);
    diffOptions(name, lc, ec, strict, controlPolicy, failures, warnings);
  }

  return { failures, warnings };
}

function formatIndexName(index: MongoSchemaIndex): string {
  return index.keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

function diffIndexes(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaDiffIssue[],
  warnings: SchemaDiffIssue[],
): void {
  const liveLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of live.indexes) liveLookup.set(indexLookupKey(idx), idx);

  const expectedLookup = new Map<string, MongoSchemaIndex>();
  for (const idx of expected.indexes) expectedLookup.set(indexLookupKey(idx), idx);

  for (const [key, idx] of expectedLookup) {
    if (!liveLookup.has(key)) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy,
        {
          path: [collName, `index:${formatIndexName(idx)}`],
          expected: idx,
        },
        'fail',
        failures,
        warnings,
      );
    }
  }

  for (const [key, idx] of liveLookup) {
    if (!expectedLookup.has(key)) {
      emitMongoIssueUnderControlPolicy(
        collectionControlPolicy,
        {
          path: [collName, `index:${formatIndexName(idx)}`],
          actual: idx,
        },
        strict ? 'fail' : 'warn',
        failures,
        warnings,
      );
    }
  }
}

function diffValidator(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaDiffIssue[],
  warnings: SchemaDiffIssue[],
): void {
  if (!live.validator && !expected.validator) return;

  if (expected.validator && !live.validator) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        path: [collName, 'validator'],
        expected: expected.validator,
      },
      'fail',
      failures,
      warnings,
    );
    return;
  }

  if (!expected.validator && live.validator) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        path: [collName, 'validator'],
        actual: live.validator,
      },
      strict ? 'fail' : 'warn',
      failures,
      warnings,
    );
    return;
  }

  const liveVal = live.validator as NonNullable<typeof live.validator>;
  const expectedVal = expected.validator as NonNullable<typeof expected.validator>;
  const liveSchema = canonicalize(liveVal.jsonSchema);
  const expectedSchema = canonicalize(expectedVal.jsonSchema);

  if (
    liveSchema !== expectedSchema ||
    liveVal.validationLevel !== expectedVal.validationLevel ||
    liveVal.validationAction !== expectedVal.validationAction
  ) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        path: [collName, 'validator'],
        expected: expectedVal,
        actual: liveVal,
      },
      'fail',
      failures,
      warnings,
    );
  }
}

function diffOptions(
  collName: string,
  live: MongoSchemaCollection,
  expected: MongoSchemaCollection,
  strict: boolean,
  collectionControlPolicy: ControlPolicy,
  failures: SchemaDiffIssue[],
  warnings: SchemaDiffIssue[],
): void {
  if (!live.options && !expected.options) return;

  if (!expected.options && live.options) {
    emitMongoIssueUnderControlPolicy(
      collectionControlPolicy,
      {
        path: [collName, 'options'],
        actual: live.options,
      },
      strict ? 'fail' : 'warn',
      failures,
      warnings,
    );
    return;
  }

  if (deepEqual(live.options, expected.options)) {
    return;
  }

  emitMongoIssueUnderControlPolicy(
    collectionControlPolicy,
    {
      path: [collName, 'options'],
      ...ifDefined('expected', expected.options),
      ...ifDefined('actual', live.options),
    },
    'fail',
    failures,
    warnings,
  );
}
