/**
 * The database's policies: its change policy and its data protection policy. A ref declares them;
 * the application space's marker records them in `meta.policies`. See ADR 314.
 */

import type { ContractMarkerRecord } from '@internal/contract/types';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type } from 'arktype';

export const CHANGE_STRATEGIES = ['migrate', 'reconcile'] as const;
export const DATA_LOSS_LEVELS = [
  'data-loss-forbidden',
  'data-loss-with-consent',
  'data-loss-permitted',
] as const;
export const ACCESS_WIDENING_LEVELS = [
  'access-widening-forbidden',
  'access-widening-with-consent',
  'access-widening-permitted',
] as const;

/** How a database may change: through migrations (`migrate`), through `db update` (`reconcile`), or both. */
export type ChangeStrategy = (typeof CHANGE_STRATEGIES)[number];
export type DataLossLevel = (typeof DATA_LOSS_LEVELS)[number];
export type AccessWideningLevel = (typeof ACCESS_WIDENING_LEVELS)[number];

/** The policies in force on a database, every setting filled. */
export interface DatabasePolicies {
  readonly change: readonly ChangeStrategy[];
  readonly dataProtection: {
    readonly dataLoss: DataLossLevel;
    readonly accessWidening: AccessWideningLevel;
  };
}

/** What a ref declares: every key optional; an absent key declares nothing. */
export interface DeclaredDatabasePolicies {
  readonly change?: readonly ChangeStrategy[];
  readonly dataProtection?: {
    readonly dataLoss?: DataLossLevel;
    readonly accessWidening?: AccessWideningLevel;
  };
}

/** The key of the marker's `meta` that holds the database's policies. */
export const DATABASE_POLICIES_META_KEY = 'policies';

export const DEFAULT_DATABASE_POLICIES: DatabasePolicies = {
  change: ['migrate', 'reconcile'],
  dataProtection: {
    dataLoss: 'data-loss-with-consent',
    accessWidening: 'access-widening-with-consent',
  },
};

const changeSchema = type
  .enumerated(...CHANGE_STRATEGIES)
  .array()
  .atLeastLength(1);
const dataLossSchema = type.enumerated(...DATA_LOSS_LEVELS);
const accessWideningSchema = type.enumerated(...ACCESS_WIDENING_LEVELS);

/** Policies with any setting left out: what a ref declares, and what a marker may record. */
export const PartialDatabasePoliciesSchema = type({
  '+': 'reject',
  'change?': changeSchema,
  'dataProtection?': {
    '+': 'reject',
    'dataLoss?': dataLossSchema,
    'accessWidening?': accessWideningSchema,
  },
});

export const DatabasePoliciesSchema = type({
  '+': 'reject',
  change: changeSchema,
  dataProtection: {
    '+': 'reject',
    dataLoss: dataLossSchema,
    accessWidening: accessWideningSchema,
  },
});

function sortedStrategies(change: readonly ChangeStrategy[]): readonly ChangeStrategy[] {
  return [...new Set(change)].sort();
}

/** `inForce` with every setting `declared` carries laid over it. */
export function withDeclaredDatabasePolicies(
  inForce: DatabasePolicies,
  declared: DeclaredDatabasePolicies,
): DatabasePolicies {
  return {
    change: sortedStrategies(declared.change ?? inForce.change),
    dataProtection: {
      dataLoss: declared.dataProtection?.dataLoss ?? inForce.dataProtection.dataLoss,
      accessWidening:
        declared.dataProtection?.accessWidening ?? inForce.dataProtection.accessWidening,
    },
  };
}

/** Why a marker's recorded policies cannot be read. */
export interface DatabasePoliciesUnreadable {
  readonly why: string;
}

/**
 * The policies in force on a database whose application space's marker is `marker`: what it
 * records, with every absent setting taken from {@link DEFAULT_DATABASE_POLICIES}.
 */
export function databasePoliciesOf(
  marker: ContractMarkerRecord | null | undefined,
): Result<DatabasePolicies, DatabasePoliciesUnreadable> {
  const recorded = marker?.meta[DATABASE_POLICIES_META_KEY];
  if (recorded === undefined) return ok(DEFAULT_DATABASE_POLICIES);
  const declared = PartialDatabasePoliciesSchema(recorded);
  if (declared instanceof type.errors) {
    return notOk({
      why: `The marker's meta.${DATABASE_POLICIES_META_KEY} is not a valid policy declaration: ${declared.summary}`,
    });
  }
  return ok(withDeclaredDatabasePolicies(DEFAULT_DATABASE_POLICIES, declared));
}

/** A setting of the policies, named by its key path in a ref's `policies`. */
export type DatabasePolicySetting =
  | 'change'
  | 'dataProtection.dataLoss'
  | 'dataProtection.accessWidening';

export type DatabasePolicyDifference =
  | {
      readonly setting: 'change';
      readonly declared: readonly ChangeStrategy[];
      readonly inForce: readonly ChangeStrategy[];
    }
  | {
      readonly setting: 'dataProtection.dataLoss';
      readonly declared: DataLossLevel;
      readonly inForce: DataLossLevel;
    }
  | {
      readonly setting: 'dataProtection.accessWidening';
      readonly declared: AccessWideningLevel;
      readonly inForce: AccessWideningLevel;
    };

/** The settings `declared` carries whose value differs from the one in force, in a fixed order. */
export function databasePolicyDifferences(
  declared: DeclaredDatabasePolicies,
  inForce: DatabasePolicies,
): readonly DatabasePolicyDifference[] {
  const differences: DatabasePolicyDifference[] = [];
  if (declared.change !== undefined) {
    const declaredChange = sortedStrategies(declared.change);
    const inForceChange = sortedStrategies(inForce.change);
    if (declaredChange.join(',') !== inForceChange.join(',')) {
      differences.push({ setting: 'change', declared: declaredChange, inForce: inForceChange });
    }
  }
  const { dataLoss, accessWidening } = declared.dataProtection ?? {};
  if (dataLoss !== undefined && dataLoss !== inForce.dataProtection.dataLoss) {
    differences.push({
      setting: 'dataProtection.dataLoss',
      declared: dataLoss,
      inForce: inForce.dataProtection.dataLoss,
    });
  }
  if (accessWidening !== undefined && accessWidening !== inForce.dataProtection.accessWidening) {
    differences.push({
      setting: 'dataProtection.accessWidening',
      declared: accessWidening,
      inForce: inForce.dataProtection.accessWidening,
    });
  }
  return differences;
}

/**
 * Whether `marker` records the policies `expected`, as a runner checks under its lock that the
 * policies a caller checked are still those in force. A marker whose policies cannot be read
 * does not hold them.
 */
export function markerHoldsDatabasePolicies(
  marker: ContractMarkerRecord | null | undefined,
  expected: DatabasePolicies,
): boolean {
  const inForce = databasePoliciesOf(marker);
  return inForce.ok && databasePolicyDifferences(expected, inForce.value).length === 0;
}

/** The policies as a marker stores them under {@link DATABASE_POLICIES_META_KEY}: plain JSON. */
export interface StoredDatabasePolicies {
  readonly change: ChangeStrategy[];
  readonly dataProtection: {
    readonly dataLoss: DataLossLevel;
    readonly accessWidening: AccessWideningLevel;
  };
}

export function storedDatabasePolicies(policies: DatabasePolicies): StoredDatabasePolicies {
  return {
    change: [...sortedStrategies(policies.change)],
    dataProtection: {
      dataLoss: policies.dataProtection.dataLoss,
      accessWidening: policies.dataProtection.accessWidening,
    },
  };
}
