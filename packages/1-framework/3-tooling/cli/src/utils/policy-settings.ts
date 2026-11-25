import {
  ACCESS_WIDENING_LEVELS,
  type AccessWideningLevel,
  CHANGE_STRATEGIES,
  type ChangeStrategy,
  DATA_LOSS_LEVELS,
  type DatabasePolicyDifference,
  type DataLossLevel,
} from '@internal/framework-components/control';
import type { DataProtectionSetting } from './data-protection-settings';

/** A policy setting, named by its key path in a ref's `policies`, as errors and output name it. */
export type PolicySetting = DatabasePolicyDifference['setting'];

export const POLICY_SETTINGS = [
  'change',
  'dataProtection.dataLoss',
  'dataProtection.accessWidening',
] as const satisfies readonly PolicySetting[];

/** What happens to a policy when a setting moves from one value to another. */
export type PolicyEffect = 'tightens' | 'loosens' | 'unchanged';

/** A setting moving from one value to another. */
export type PolicyMove =
  | {
      readonly setting: 'change';
      readonly from: readonly ChangeStrategy[];
      readonly to: readonly ChangeStrategy[];
    }
  | {
      readonly setting: 'dataProtection.dataLoss';
      readonly from: DataLossLevel;
      readonly to: DataLossLevel;
    }
  | {
      readonly setting: 'dataProtection.accessWidening';
      readonly from: AccessWideningLevel;
      readonly to: AccessWideningLevel;
    };

/** A data protection setting's flag and its levels, strictest first, as the framework lists them. */
export interface DataProtectionFlag<L extends string> {
  readonly key: DataProtectionSetting;
  readonly setting: PolicySetting;
  readonly flag: string;
  readonly levels: readonly L[];
}

export const DATA_PROTECTION_FLAGS = {
  dataLoss: {
    key: 'dataLoss',
    setting: 'dataProtection.dataLoss',
    flag: 'data-loss',
    levels: DATA_LOSS_LEVELS,
  },
  accessWidening: {
    key: 'accessWidening',
    setting: 'dataProtection.accessWidening',
    flag: 'access-widening',
    levels: ACCESS_WIDENING_LEVELS,
  },
} as const satisfies {
  readonly dataLoss: DataProtectionFlag<DataLossLevel>;
  readonly accessWidening: DataProtectionFlag<AccessWideningLevel>;
};

/** A setting's levels without the setting's name in front: `forbidden`, `with-consent`, `permitted`. */
export function shortLevels<L extends string>(spec: DataProtectionFlag<L>): readonly string[] {
  const prefix = `${spec.flag}-`;
  return spec.levels.map((level) => level.slice(prefix.length));
}

/** The level a flag value names, in its short form or the long form of its own setting. */
export function levelFromFlag<L extends string>(
  spec: DataProtectionFlag<L>,
  value: string,
): L | undefined {
  return spec.levels.find((level) => level === value || level === `${spec.flag}-${value}`);
}

function levelEffect<L extends string>(levels: readonly L[], from: L, to: L): PolicyEffect {
  const before = levels.indexOf(from);
  const after = levels.indexOf(to);
  if (before === after) return 'unchanged';
  return after < before ? 'tightens' : 'loosens';
}

function changeEffect(
  from: readonly ChangeStrategy[],
  to: readonly ChangeStrategy[],
): PolicyEffect {
  const before = new Set(from);
  const after = new Set(to);
  if ([...after].some((strategy) => !before.has(strategy))) return 'loosens';
  return after.size < before.size ? 'tightens' : 'unchanged';
}

/** Whether a move makes the policy stricter or more permissive: adding a change strategy, or a less strict level, loosens it. */
export function policyMoveEffect(move: PolicyMove): PolicyEffect {
  switch (move.setting) {
    case 'change':
      return changeEffect(move.from, move.to);
    case 'dataProtection.dataLoss':
      return levelEffect(DATA_LOSS_LEVELS, move.from, move.to);
    case 'dataProtection.accessWidening':
      return levelEffect(ACCESS_WIDENING_LEVELS, move.from, move.to);
  }
}

/** The move that would make what a ref declares equal what the database has. */
export function refToDatabaseMove(difference: DatabasePolicyDifference): PolicyMove {
  switch (difference.setting) {
    case 'change':
      return { setting: 'change', from: difference.declared, to: difference.inForce };
    case 'dataProtection.dataLoss':
      return { setting: difference.setting, from: difference.declared, to: difference.inForce };
    case 'dataProtection.accessWidening':
      return { setting: difference.setting, from: difference.declared, to: difference.inForce };
  }
}

/** The change strategies without repeats, in the framework's order. */
export function canonicalChange(change: Iterable<ChangeStrategy>): ChangeStrategy[] {
  const given = new Set(change);
  return CHANGE_STRATEGIES.filter((strategy) => given.has(strategy));
}
