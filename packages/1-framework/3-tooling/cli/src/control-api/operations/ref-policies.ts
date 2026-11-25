import type { PrismaConfig } from '@internal/config/config-types';
import {
  type AccessWideningLevel,
  CHANGE_STRATEGIES,
  type ChangeStrategy,
  type DataLossLevel,
  databasePolicyValueText,
} from '@internal/framework-components/control';
import { HEAD_REF_NAME, type RefEntry, readRef, writeRef } from '@internal/migration-tools/refs';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join } from 'pathe';
import { ActionableCliError, type CliStructuredError } from '../../utils/cli-errors';
import { resolveMigrationPaths } from '../../utils/command-helpers';
import { chooseAction } from '../../utils/next-actions';
import {
  canonicalChange,
  DATA_PROTECTION_SETTINGS,
  type DataProtectionSettingSpec,
  DEFAULT_SETTINGS,
  type DeclaredSettings,
  declaredPolicies,
  declaredSettings,
  levelFromInput,
  POLICY_SETTINGS,
  type PolicyEffect,
  type PolicySetting,
  type PolicySettingValue,
  policyValueEffect,
  shortLevels,
} from '../../utils/policy-settings';
import { errorFromCaught } from './caught-errors';

/** What a ref declares, as the commands report it: every setting present, `null` where the ref declares nothing. */
export interface DeclaredPoliciesReport {
  readonly change: readonly ChangeStrategy[] | null;
  readonly dataProtection: {
    readonly dataLoss: DataLossLevel | null;
    readonly accessWidening: AccessWideningLevel | null;
  };
}

/** A setting whose declared value a command changed, and what that does to the policy in effect. */
export interface RefPolicyChange {
  readonly setting: PolicySetting;
  readonly before: PolicySettingValue | null;
  readonly after: PolicySettingValue | null;
  readonly effect: PolicyEffect;
}

export interface RefPoliciesResult {
  readonly ok: true;
  readonly ref: string;
  readonly policies: DeclaredPoliciesReport;
  readonly changes: readonly RefPolicyChange[];
}

export interface RefPoliciesOutcome {
  readonly result: RefPoliciesResult;
  /** The settings the ref declares after the command. */
  readonly declared: DeclaredSettings;
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

type Edit = (declared: DeclaredSettings) => DeclaredSettings;

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
  return invalidArguments(
    'The head ref cannot declare policies',
    'head is the ref the CLI keeps at the newest contract; a team does not declare policies for it.',
    'Name a ref your team keeps for a database, such as staging or production.',
    { refName: HEAD_REF_NAME },
  );
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
  spec: DataProtectionSettingSpec<L>,
  value: string | undefined,
): Result<L | undefined, ActionableCliError> {
  if (value === undefined) return ok(undefined);
  const level = levelFromInput(spec, value);
  if (level !== undefined) return ok(level);
  const allowed = shortLevels(spec);
  return notOk(
    invalidArguments(
      `--${spec.flag} does not accept "${value}"`,
      `--${spec.flag} takes ${orList(allowed)}, or the same with ${spec.levelPrefix} in front.`,
      `Pass --${spec.flag} ${orList(allowed)}.`,
      { flag: `--${spec.flag}`, value, allowed },
    ),
  );
}

function parseSetEdit(input: RefPolicySetInput): Result<Edit, ActionableCliError> {
  const changeValues = input.change ?? [];
  const change = parseChange(changeValues);
  if (!change.ok) return change;
  const dataLoss = parseLevel(DATA_PROTECTION_SETTINGS.dataLoss, input.dataLoss);
  if (!dataLoss.ok) return dataLoss;
  const accessWidening = parseLevel(DATA_PROTECTION_SETTINGS.accessWidening, input.accessWidening);
  if (!accessWidening.ok) return accessWidening;
  const given: Partial<DeclaredSettings> = {
    ...ifDefined('change', changeValues.length === 0 ? undefined : change.value),
    ...ifDefined('dataProtection.dataLoss', dataLoss.value),
    ...ifDefined('dataProtection.accessWidening', accessWidening.value),
  };
  if (Object.keys(given).length === 0) {
    return notOk(
      invalidArguments(
        'Nothing to set',
        'No setting was given to write.',
        'Pass at least one of --change, --data-loss and --access-widening.',
        { flags: ['--change', '--data-loss', '--access-widening'] },
      ),
    );
  }
  return ok((declared) => ({ ...declared, ...given }));
}

const SETTING_NAMES: Readonly<Record<string, PolicySetting>> = {
  ...Object.fromEntries(POLICY_SETTINGS.map((setting) => [setting, setting])),
  [DATA_PROTECTION_SETTINGS.dataLoss.flag]: DATA_PROTECTION_SETTINGS.dataLoss.setting,
  [DATA_PROTECTION_SETTINGS.accessWidening.flag]: DATA_PROTECTION_SETTINGS.accessWidening.setting,
};

function parseDeleteEdit(names: readonly string[]): Result<Edit, ActionableCliError> {
  const settingList = `${orList(POLICY_SETTINGS)}, or by its flag name: ${DATA_PROTECTION_SETTINGS.dataLoss.flag} or ${DATA_PROTECTION_SETTINGS.accessWidening.flag}`;
  if (names.length === 0) {
    return notOk(
      invalidArguments(
        'No setting to delete',
        'No setting was named to remove.',
        `Name at least one setting after the ref name: ${orList(Object.keys(SETTING_NAMES))}.`,
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
  return ok((declared) => {
    const kept: { -readonly [S in PolicySetting]: PolicySettingValue<S> | undefined } = {
      ...declared,
    };
    for (const setting of removed) kept[setting] = undefined;
    return kept;
  });
}

function report(settings: DeclaredSettings): DeclaredPoliciesReport {
  return {
    change: settings.change ?? null,
    dataProtection: {
      dataLoss: settings['dataProtection.dataLoss'] ?? null,
      accessWidening: settings['dataProtection.accessWidening'] ?? null,
    },
  };
}

function sameValue(a: PolicySettingValue | undefined, b: PolicySettingValue | undefined): boolean {
  return a === undefined || b === undefined
    ? a === b
    : databasePolicyValueText(a) === databasePolicyValueText(b);
}

/** Each setting whose declared value differs. A removed setting stops being checked, so removing one never tightens a policy. */
function settingChanges(
  before: DeclaredSettings,
  after: DeclaredSettings,
): readonly RefPolicyChange[] {
  return POLICY_SETTINGS.flatMap((setting) => {
    const from = before[setting];
    const to = after[setting];
    if (sameValue(from, to)) return [];
    const effect = policyValueEffect(
      setting,
      from ?? DEFAULT_SETTINGS[setting],
      to ?? DEFAULT_SETTINGS[setting],
    );
    return [
      {
        setting,
        before: from ?? null,
        after: to ?? null,
        effect: to === undefined && effect === 'tightens' ? 'unchanged' : effect,
      },
    ];
  });
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
    const before = declaredSettings(entry.policies);
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
      result: { ok: true as const, ref: name, policies: report(after), changes },
      declared: after,
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
