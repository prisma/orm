import {
  ACCESS_WIDENING_LEVELS,
  type AccessWideningLevel,
  CHANGE_STRATEGIES,
  type ChangeStrategy,
  DATA_LOSS_LEVELS,
  type DatabasePolicies,
  type DatabasePolicyDifference,
  type DataLossLevel,
  DEFAULT_DATABASE_POLICIES,
  type DeclaredDatabasePolicies,
  databasePolicyValueText,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';

/** A data protection setting's key in `dataProtection`, as the framework's `DATA_PROTECTION_KEYS` lists them: `dataLoss`, `accessWidening`. */
export type DataProtectionKey = keyof DatabasePolicies['dataProtection'];

type LevelOf = { readonly [K in DataProtectionKey]: DatabasePolicies['dataProtection'][K] };

export const FORBIDDEN_LEVEL = {
  dataLoss: 'data-loss-forbidden',
  accessWidening: 'access-widening-forbidden',
} as const satisfies LevelOf;

export const PERMITTED_LEVEL = {
  dataLoss: 'data-loss-permitted',
  accessWidening: 'access-widening-permitted',
} as const satisfies LevelOf;

/** A policy setting, named by its key path in a ref's `policies`, as errors and output name it: `change`, `dataProtection.dataLoss`. */
export type PolicySetting = DatabasePolicyDifference['setting'];

/** The value setting `S` holds: change strategies, or a level. */
export type PolicySettingValue<S extends PolicySetting = PolicySetting> = Extract<
  DatabasePolicyDifference,
  { readonly setting: S }
>['declared'];

export const POLICY_SETTINGS = [
  'change',
  'dataProtection.dataLoss',
  'dataProtection.accessWidening',
] as const satisfies readonly PolicySetting[];

/** The settings a ref declares, by key path; `undefined` where it declares nothing. */
export type DeclaredSettings = {
  readonly [S in PolicySetting]: PolicySettingValue<S> | undefined;
};

/** Each setting's value in a database that records no policies. */
export const DEFAULT_SETTINGS: { readonly [S in PolicySetting]: PolicySettingValue<S> } = {
  change: DEFAULT_DATABASE_POLICIES.change,
  'dataProtection.dataLoss': DEFAULT_DATABASE_POLICIES.dataProtection.dataLoss,
  'dataProtection.accessWidening': DEFAULT_DATABASE_POLICIES.dataProtection.accessWidening,
};

/** The change strategies without repeats, in the framework's order. */
export function canonicalChange(change: Iterable<ChangeStrategy>): ChangeStrategy[] {
  const given = new Set(change);
  return CHANGE_STRATEGIES.filter((strategy) => given.has(strategy));
}

export function declaredSettings(policies: DeclaredDatabasePolicies | undefined): DeclaredSettings {
  return {
    change: policies?.change === undefined ? undefined : canonicalChange(policies.change),
    'dataProtection.dataLoss': policies?.dataProtection?.dataLoss,
    'dataProtection.accessWidening': policies?.dataProtection?.accessWidening,
  };
}

/** The settings as a ref file stores them, in its key order, with an empty object left out. */
export function declaredPolicies(settings: DeclaredSettings): DeclaredDatabasePolicies | undefined {
  const dataLoss = settings['dataProtection.dataLoss'];
  const accessWidening = settings['dataProtection.accessWidening'];
  const dataProtection =
    dataLoss === undefined && accessWidening === undefined
      ? undefined
      : { ...ifDefined('dataLoss', dataLoss), ...ifDefined('accessWidening', accessWidening) };
  if (settings.change === undefined && dataProtection === undefined) return undefined;
  return {
    ...ifDefined('change', settings.change),
    ...ifDefined('dataProtection', dataProtection),
  };
}

/** The settings declared, each with its value, in a fixed order. */
export function declaredEntries(
  settings: DeclaredSettings,
): readonly (readonly [PolicySetting, PolicySettingValue])[] {
  return POLICY_SETTINGS.flatMap((setting) => {
    const value = settings[setting];
    return value === undefined ? [] : [[setting, value] as const];
  });
}

/** `change: migrate; dataProtection.dataLoss: data-loss-forbidden`. */
export function settingsText(
  entries: readonly (readonly [PolicySetting, PolicySettingValue])[],
): string {
  return entries
    .map(([setting, value]) => `${setting}: ${databasePolicyValueText(value)}`)
    .join('; ');
}

/** What happens to a policy when a setting moves from one value to another. */
export type PolicyEffect = 'tightens' | 'loosens' | 'unchanged';

function changeEffect(
  from: readonly ChangeStrategy[],
  to: readonly ChangeStrategy[],
): PolicyEffect {
  const before = new Set(from);
  const after = new Set(to);
  if ([...after].some((strategy) => !before.has(strategy))) return 'loosens';
  return after.size < before.size ? 'tightens' : 'unchanged';
}

/** The levels of a data protection setting, strictest first, as the framework lists them; a change policy has none. */
function levelsOf(setting: PolicySetting): readonly PolicySettingValue[] {
  switch (setting) {
    case 'change':
      return [];
    case 'dataProtection.dataLoss':
      return DATA_LOSS_LEVELS;
    case 'dataProtection.accessWidening':
      return ACCESS_WIDENING_LEVELS;
  }
}

/** Whether moving `setting` from `from` to `to` makes the policy stricter or more permissive: adding a change strategy, or a less strict level, loosens it. */
export function policyValueEffect<S extends PolicySetting>(
  setting: S,
  from: PolicySettingValue<S>,
  to: PolicySettingValue<S>,
): PolicyEffect;
export function policyValueEffect(
  setting: PolicySetting,
  from: PolicySettingValue,
  to: PolicySettingValue,
): PolicyEffect {
  if (typeof from !== 'string' && typeof to !== 'string') return changeEffect(from, to);
  const levels = levelsOf(setting);
  const before = levels.indexOf(from);
  const after = levels.indexOf(to);
  if (before === after) return 'unchanged';
  return after < before ? 'tightens' : 'loosens';
}

const FORBIDDEN_LEVELS: readonly PolicySettingValue[] = Object.values(FORBIDDEN_LEVEL);

/** A level at which `migration plan --to <ref>` refuses a plan the setting forbids. */
export function isForbiddenLevel(value: PolicySettingValue): boolean {
  return FORBIDDEN_LEVELS.includes(value);
}

/** A data protection setting as the CLI takes it: its flag, and its levels, strictest first, with the prefix the short form leaves out. */
export interface DataProtectionSettingSpec<L extends string> {
  readonly key: DataProtectionKey;
  readonly setting: PolicySetting;
  readonly flag: string;
  readonly levelPrefix: string;
  readonly levels: readonly L[];
}

export const DATA_PROTECTION_SETTINGS = {
  dataLoss: {
    key: 'dataLoss',
    setting: 'dataProtection.dataLoss',
    flag: 'data-loss',
    levelPrefix: 'data-loss-',
    levels: DATA_LOSS_LEVELS,
  },
  accessWidening: {
    key: 'accessWidening',
    setting: 'dataProtection.accessWidening',
    flag: 'access-widening',
    levelPrefix: 'access-widening-',
    levels: ACCESS_WIDENING_LEVELS,
  },
} as const satisfies {
  readonly dataLoss: DataProtectionSettingSpec<DataLossLevel>;
  readonly accessWidening: DataProtectionSettingSpec<AccessWideningLevel>;
};

/** A setting's levels without the prefix: `forbidden`, `with-consent`, `permitted`. */
export function shortLevels<L extends string>(
  spec: DataProtectionSettingSpec<L>,
): readonly string[] {
  return spec.levels.map((level) => level.slice(spec.levelPrefix.length));
}

/** The level a value names, in its short form or the long form of its own setting. */
export function levelFromInput<L extends string>(
  spec: DataProtectionSettingSpec<L>,
  value: string,
): L | undefined {
  return spec.levels.find((level) => level === value || level === `${spec.levelPrefix}${value}`);
}
