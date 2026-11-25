import type { PrismaConfig } from '@internal/config/config-types';
import {
  type AccessWideningLevel,
  CHANGE_STRATEGIES,
  type ChangeStrategy,
  type DataLossLevel,
  DEFAULT_DATABASE_POLICIES,
  type DeclaredDatabasePolicies,
} from '@internal/framework-components/control';
import { HEAD_REF_NAME, type RefEntry, readRef, writeRef } from '@internal/migration-tools/refs';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join } from 'pathe';
import { ActionableCliError, type CliStructuredError } from '../../utils/cli-errors';
import { resolveMigrationPaths } from '../../utils/command-helpers';
import { chooseAction, runCommandAction } from '../../utils/next-actions';
import {
  canonicalChange,
  DATA_PROTECTION_FLAGS,
  type DataProtectionFlag,
  levelFromFlag,
  POLICY_SETTINGS,
  type PolicyEffect,
  type PolicyMove,
  type PolicySetting,
  policyMoveEffect,
  shortLevels,
} from '../../utils/policy-settings';
import { errorFromCaught } from './caught-errors';

/** What a ref declares for each setting, `null` where it declares nothing. */
export interface RefPolicies {
  readonly change: readonly ChangeStrategy[] | null;
  readonly dataProtection: {
    readonly dataLoss: DataLossLevel | null;
    readonly accessWidening: AccessWideningLevel | null;
  };
}

export type RefPolicyValue = readonly ChangeStrategy[] | DataLossLevel | AccessWideningLevel;

/** A setting whose declared value a command changed, and what that does to the policy in effect. */
export interface RefPolicyChange {
  readonly setting: PolicySetting;
  readonly before: RefPolicyValue | null;
  readonly after: RefPolicyValue | null;
  readonly effect: PolicyEffect;
}

export interface RefPoliciesResult {
  readonly ok: true;
  readonly ref: string;
  readonly policies: RefPolicies;
  readonly changes: readonly RefPolicyChange[];
}

export interface RefPoliciesOutcome {
  readonly result: RefPoliciesResult;
  readonly refFile: string;
}

export interface RefPolicySetInput {
  /** Undefined or empty when `--change` was not given: the engine gives a repeated flag no value when it is absent. */
  readonly change: readonly string[] | undefined;
  readonly dataLoss: string | undefined;
  readonly accessWidening: string | undefined;
}

export interface RefPoliciesOperationOptions {
  readonly config: PrismaConfig;
  readonly cwd: string;
}

type Settings = {
  readonly change: readonly ChangeStrategy[] | undefined;
  readonly dataLoss: DataLossLevel | undefined;
  readonly accessWidening: AccessWideningLevel | undefined;
};

type Edit = (declared: Settings) => Settings;

function invalidArguments(
  summary: string,
  why: string,
  fix: string,
  meta: Record<string, unknown>,
): ActionableCliError {
  return new ActionableCliError('CLI.INVALID_ARGUMENTS', summary, {
    why,
    fix,
    nextActions: [chooseAction(fix)],
    meta,
  });
}

function errorHeadRef(): ActionableCliError {
  const fix = 'Name a ref your team keeps, such as staging or production.';
  return new ActionableCliError('CLI.INVALID_ARGUMENTS', 'The head ref declares no policies', {
    why: 'head is the ref the CLI keeps at the newest contract; a team does not declare policies for it.',
    fix,
    nextActions: [chooseAction(fix), runCommandAction('List the refs', '{bin} migration ref list')],
    meta: { refName: HEAD_REF_NAME },
  });
}

function orList(values: readonly string[]): string {
  return values.length <= 1
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

function parseChange(values: readonly string[]): Result<ChangeStrategy[], ActionableCliError> {
  const strategies: ChangeStrategy[] = [];
  for (const value of values) {
    const strategy = CHANGE_STRATEGIES.find((candidate) => candidate === value);
    if (strategy === undefined) {
      return notOk(
        invalidArguments(
          `--change does not accept "${value}"`,
          `--change takes ${orList(CHANGE_STRATEGIES)}. Repeat the flag to permit both.`,
          'Pass --change migrate, --change reconcile, or both.',
          { flag: '--change', value, allowed: CHANGE_STRATEGIES },
        ),
      );
    }
    strategies.push(strategy);
  }
  return ok(canonicalChange(strategies));
}

function parseLevel<L extends string>(
  spec: DataProtectionFlag<L>,
  value: string | undefined,
): Result<L | undefined, ActionableCliError> {
  if (value === undefined) return ok(undefined);
  const level = levelFromFlag(spec, value);
  if (level !== undefined) return ok(level);
  const allowed = shortLevels(spec);
  return notOk(
    invalidArguments(
      `--${spec.flag} does not accept "${value}"`,
      `--${spec.flag} takes ${orList(allowed)}, or the same with ${spec.flag}- in front.`,
      `Pass --${spec.flag} ${orList(allowed)}.`,
      { flag: `--${spec.flag}`, value, allowed },
    ),
  );
}

function parseSetEdit(input: RefPolicySetInput): Result<Edit, ActionableCliError> {
  const changeValues = input.change ?? [];
  const change = parseChange(changeValues);
  if (!change.ok) return change;
  const dataLoss = parseLevel(DATA_PROTECTION_FLAGS.dataLoss, input.dataLoss);
  if (!dataLoss.ok) return dataLoss;
  const accessWidening = parseLevel(DATA_PROTECTION_FLAGS.accessWidening, input.accessWidening);
  if (!accessWidening.ok) return accessWidening;
  const given = {
    change: changeValues.length === 0 ? undefined : change.value,
    dataLoss: dataLoss.value,
    accessWidening: accessWidening.value,
  };
  if (Object.values(given).every((value) => value === undefined)) {
    return notOk(
      invalidArguments(
        'Nothing to set',
        'No setting was given to write.',
        'Pass at least one of --change, --data-loss and --access-widening.',
        { flags: ['--change', '--data-loss', '--access-widening'] },
      ),
    );
  }
  return ok((declared) => ({
    change: given.change ?? declared.change,
    dataLoss: given.dataLoss ?? declared.dataLoss,
    accessWidening: given.accessWidening ?? declared.accessWidening,
  }));
}

const SETTING_NAMES: Readonly<Record<string, PolicySetting>> = {
  ...Object.fromEntries(POLICY_SETTINGS.map((setting) => [setting, setting])),
  [DATA_PROTECTION_FLAGS.dataLoss.flag]: DATA_PROTECTION_FLAGS.dataLoss.setting,
  [DATA_PROTECTION_FLAGS.accessWidening.flag]: DATA_PROTECTION_FLAGS.accessWidening.setting,
};

function parseDeleteEdit(names: readonly string[]): Result<Edit, ActionableCliError> {
  const settingList = `${orList(POLICY_SETTINGS)}, or by its flag name: ${DATA_PROTECTION_FLAGS.dataLoss.flag} or ${DATA_PROTECTION_FLAGS.accessWidening.flag}`;
  if (names.length === 0) {
    return notOk(
      invalidArguments(
        'No setting to delete',
        'Name the settings to remove after the ref name.',
        `Name at least one setting: ${settingList}.`,
        { allowed: Object.keys(SETTING_NAMES) },
      ),
    );
  }
  const removed = new Set<PolicySetting>();
  for (const name of names) {
    const setting = Object.hasOwn(SETTING_NAMES, name) ? SETTING_NAMES[name] : undefined;
    if (setting === undefined) {
      return notOk(
        invalidArguments(
          `"${name}" is not a policy setting`,
          `A setting is named ${settingList}.`,
          'Name one of those settings.',
          { value: name, allowed: Object.keys(SETTING_NAMES) },
        ),
      );
    }
    removed.add(setting);
  }
  return ok((declared) => ({
    change: removed.has('change') ? undefined : declared.change,
    dataLoss: removed.has('dataProtection.dataLoss') ? undefined : declared.dataLoss,
    accessWidening: removed.has('dataProtection.accessWidening')
      ? undefined
      : declared.accessWidening,
  }));
}

function settingsOf(policies: DeclaredDatabasePolicies | undefined): Settings {
  return {
    change: policies?.change === undefined ? undefined : canonicalChange(policies.change),
    dataLoss: policies?.dataProtection?.dataLoss,
    accessWidening: policies?.dataProtection?.accessWidening,
  };
}

/** The settings in the order the ref file format stores them, with an empty object left out. */
function declaredPolicies(settings: Settings): DeclaredDatabasePolicies | undefined {
  const dataProtection =
    settings.dataLoss === undefined && settings.accessWidening === undefined
      ? undefined
      : {
          ...ifDefined('dataLoss', settings.dataLoss),
          ...ifDefined('accessWidening', settings.accessWidening),
        };
  if (settings.change === undefined && dataProtection === undefined) return undefined;
  return {
    ...ifDefined('change', settings.change),
    ...ifDefined('dataProtection', dataProtection),
  };
}

function refPolicies(settings: Settings): RefPolicies {
  return {
    change: settings.change ?? null,
    dataProtection: {
      dataLoss: settings.dataLoss ?? null,
      accessWidening: settings.accessWidening ?? null,
    },
  };
}

/** A removed setting stops being checked, so a delete never tightens a policy. */
function effectOf(move: PolicyMove, removed: boolean): PolicyEffect {
  const effect = policyMoveEffect(move);
  return removed && effect === 'tightens' ? 'unchanged' : effect;
}

function sameChange(
  a: readonly ChangeStrategy[] | undefined,
  b: readonly ChangeStrategy[] | undefined,
): boolean {
  return a === undefined || b === undefined ? a === b : a.join(',') === b.join(',');
}

function settingChanges(before: Settings, after: Settings): readonly RefPolicyChange[] {
  const defaults = DEFAULT_DATABASE_POLICIES;
  const changes: RefPolicyChange[] = [];
  if (!sameChange(before.change, after.change)) {
    changes.push({
      setting: 'change',
      before: before.change ?? null,
      after: after.change ?? null,
      effect: effectOf(
        {
          setting: 'change',
          from: before.change ?? defaults.change,
          to: after.change ?? defaults.change,
        },
        after.change === undefined,
      ),
    });
  }
  if (before.dataLoss !== after.dataLoss) {
    changes.push({
      setting: 'dataProtection.dataLoss',
      before: before.dataLoss ?? null,
      after: after.dataLoss ?? null,
      effect: effectOf(
        {
          setting: 'dataProtection.dataLoss',
          from: before.dataLoss ?? defaults.dataProtection.dataLoss,
          to: after.dataLoss ?? defaults.dataProtection.dataLoss,
        },
        after.dataLoss === undefined,
      ),
    });
  }
  if (before.accessWidening !== after.accessWidening) {
    changes.push({
      setting: 'dataProtection.accessWidening',
      before: before.accessWidening ?? null,
      after: after.accessWidening ?? null,
      effect: effectOf(
        {
          setting: 'dataProtection.accessWidening',
          from: before.accessWidening ?? defaults.dataProtection.accessWidening,
          to: after.accessWidening ?? defaults.dataProtection.accessWidening,
        },
        after.accessWidening === undefined,
      ),
    });
  }
  return changes;
}

async function applyEdit(
  name: string,
  edit: Result<Edit, ActionableCliError> | undefined,
  options: RefPoliciesOperationOptions,
): Promise<Result<RefPoliciesOutcome, CliStructuredError>> {
  if (name === HEAD_REF_NAME) return notOk(errorHeadRef());
  if (edit !== undefined && !edit.ok) return notOk(edit.failure);
  try {
    const { refsDir } = resolveMigrationPaths(options.config, options.cwd);
    const entry = await readRef(refsDir, name);
    const before = settingsOf(entry.policies);
    const after = edit === undefined ? before : edit.value(before);
    const changes = settingChanges(before, after);
    if (changes.length > 0) {
      const written: RefEntry = {
        hash: entry.hash,
        invariants: entry.invariants,
        ...ifDefined('policies', declaredPolicies(after)),
      };
      await writeRef(refsDir, name, written);
    }
    return ok({
      result: { ok: true as const, ref: name, policies: refPolicies(after), changes },
      refFile: join(refsDir, `${name}.json`),
    });
  } catch (error) {
    return notOk(errorFromCaught(error, (message) => message));
  }
}

export function executeRefPolicyShow(
  name: string,
  options: RefPoliciesOperationOptions,
): Promise<Result<RefPoliciesOutcome, CliStructuredError>> {
  return applyEdit(name, undefined, options);
}

export function executeRefPolicySet(
  name: string,
  input: RefPolicySetInput,
  options: RefPoliciesOperationOptions,
): Promise<Result<RefPoliciesOutcome, CliStructuredError>> {
  return applyEdit(name, parseSetEdit(input), options);
}

export function executeRefPolicyDelete(
  name: string,
  settings: readonly string[],
  options: RefPoliciesOperationOptions,
): Promise<Result<RefPoliciesOutcome, CliStructuredError>> {
  return applyEdit(name, parseDeleteEdit(settings), options);
}
