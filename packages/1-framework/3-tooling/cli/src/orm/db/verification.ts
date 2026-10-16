import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  MismatchCause,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { castAs } from '@internal/utils/casts';
import { assertNever } from '@internal/utils/internal-error';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import type { Block, TreeNode } from '@prisma/cli-engine';
import type { Diagnostic, NextAction, Result } from '@prisma/cli-engine/protocol';
import { type CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import { errorFromCaught } from '../../control-api/operations/caught-errors';
import {
  errorConfigValidation,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
} from '../../utils/cli-errors';
import { chooseAction, runCommandAction } from '../../utils/next-actions';
import { issueLabel, schemaIssuesWhy } from '../../utils/schema-issues';
import { contractPathFor, displayPath } from '../migration/paths';
import { normalizeError } from '../normalize-error';

/**
 * The contract both verification commands read, and where it was read from.
 * `json` is the parsed file as read, for commands that also store it.
 */
export interface EmittedContract {
  readonly contract: Contract;
  readonly json: Record<string, unknown>;
  readonly path: string;
  readonly displayPath: string;
}

/**
 * Reads the emitted contract and hydrates it through the family's
 * `deserializeContract` seam, which is where every other on-disk contract read
 * in this CLI crosses into family types.
 */
export async function readEmittedContract(inputs: {
  readonly config: PrismaNextConfig;
  readonly cwd: string;
  readonly commandName: string;
}): Promise<Result<EmittedContract, CliStructuredError>> {
  const path = contractPathFor(inputs.config);
  if (path === undefined) {
    return notOk(
      normalizeError(
        errorConfigValidation('contract.output', {
          why: `${inputs.commandName} reads the emitted contract from config.contract.output; the config has no value to read.`,
          section: 'contract',
        }),
      ),
    );
  }
  const relativePath = displayPath(path, inputs.cwd);

  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch (error) {
    const missing = Reflect.get(Object(error), 'code') === 'ENOENT';
    return notOk(
      normalizeError(
        missing
          ? errorFileNotFound(path, {
              why: `Contract file not found at ${path}`,
              fix: `Run \`{bin} contract emit\` to generate ${relativePath}, or update \`contract.output\` in prisma.config.ts`,
            })
          : errorFromCaught(error, (message) => `Failed to read contract file: ${message}`),
      ),
    );
  }

  const familyInstance = inputs.config.family.create(createControlStack(inputs.config));
  try {
    const json = castAs<Record<string, unknown>>(JSON.parse(content));
    return ok({
      contract: familyInstance.deserializeContract(json),
      json,
      path,
      displayPath: relativePath,
    });
  } catch (error) {
    return notOk(
      normalizeError(
        errorContractValidationFailed(
          `Contract JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
          { where: { path } },
        ),
      ),
    );
  }
}

/**
 * The connection and driver both verification commands need. Returns the
 * resolved connection or the precondition failure that stopped the run.
 */
export function requireVerifyConnection(inputs: {
  readonly config: PrismaNextConfig;
  readonly db: string | undefined;
  readonly commandLine: string;
}): Result<string, CliStructuredError> {
  const dbConnection = inputs.db ?? inputs.config.db?.connection;
  if (typeof dbConnection !== 'string' || dbConnection.length === 0) {
    return notOk(
      normalizeError(
        errorDatabaseConnectionRequired({
          why: `Database connection is required for ${inputs.commandLine} (set db.connection in prisma.config.ts, or pass --db <url>)`,
          missingFlags: ['--db'],
          retryCommand: `{bin} ${inputs.commandLine} --db <url>`,
        }),
      ),
    );
  }
  if (inputs.config.driver === undefined) {
    return notOk(
      normalizeError(
        errorDriverRequired({ why: `Config.driver is required for ${inputs.commandLine}` }),
      ),
    );
  }
  return ok(dbConnection);
}

/**
 * A failure the verification could not recover from — a dropped connection, a driver throw — as a settlement the user can act on, reported as every command reports what it caught, without the connection string.
 */
export function verificationThrow(inputs: {
  readonly error: unknown;
  readonly commandLine: string;
  readonly connection: string;
}): CliStructuredError {
  return normalizeError(
    errorFromCaught(
      inputs.error,
      (message) => `Unexpected error during ${inputs.commandLine}: ${message}`,
      { connection: inputs.connection },
    ),
  );
}

export function issueNodes(
  issues: readonly SchemaDiffIssue[],
  status: 'error' | 'warn',
): TreeNode[] {
  return issues.map((issue) => ({ label: issueLabel(issue), status }));
}

/**
 * The drift, laid out as a tree the engine draws: one root per finding family,
 * one child per element. The engine owns the connectors and the status glyphs,
 * so nothing here carries an escape sequence.
 */
export function schemaFindingBlocks(inputs: {
  readonly result: VerifyDatabaseSchemaResult;
  readonly unclaimed: readonly string[];
  readonly strict: boolean;
}): readonly Block[] {
  const roots: TreeNode[] = [];
  const issues = inputs.result.schema.issues;
  if (issues.length > 0) {
    roots.push({ label: 'Schema issues', status: 'error', children: issueNodes(issues, 'error') });
  }
  const warnings = inputs.result.schema.warnings?.issues ?? [];
  if (warnings.length > 0) {
    roots.push({
      label: 'Schema warnings',
      status: 'warn',
      children: issueNodes(warnings, 'warn'),
    });
  }
  if (inputs.unclaimed.length > 0) {
    const status = inputs.strict ? 'error' : 'warn';
    roots.push({
      label: 'Unclaimed elements (declared by no contract)',
      status,
      children: inputs.unclaimed.map((name) => ({ label: name, status })),
    });
  }
  return roots.length === 0 ? [] : [{ kind: 'tree', roots }];
}

/**
 * A failed schema-verification verdict as one envelope diagnostic. `error` is
 * the honest severity: the database does not satisfy the contract. It is legal
 * because both commands settle at exit 4 — the engine refuses a
 * severity-`error` diagnostic only on a run that exits 0.
 */
export function schemaVerdictDiagnostic(inputs: {
  readonly result: VerifyDatabaseSchemaResult;
  readonly space: string | undefined;
  readonly nextActions: readonly NextAction[];
}): Diagnostic {
  const code = inputs.result.code;
  const dotted = code !== undefined && isStructuredErrorCode(code);
  const issues = inputs.result.schema.issues.map(issueLabel);
  return {
    code: dotted ? code : 'CONTRACT.VERIFY_FAILED',
    severity: 'error',
    summary: inputs.result.summary,
    ...(issues.length === 0
      ? {}
      : { why: schemaIssuesWhy('The live schema differs', inputs.result.schema.issues) }),
    nextActions: inputs.nextActions,
    meta: {
      ...(inputs.space === undefined ? {} : { space: inputs.space }),
      issues,
      ...(dotted || code === undefined ? {} : { code }),
    },
  };
}

/**
 * What to do about schema drift, by the causes the issues name. A value the emitted contract holds
 * that its type refuses is fixed only by re-emitting. A value the database may hold in a form of its
 * own is fixed in the contract when the two mean the same, and by `db update` when they do not.
 * `db update` follows when some issue is not a refused contract value; changing the contract to
 * describe the database follows when some issue has no explanation. Both follow when there is no
 * issue.
 */
export function schemaDriftNextActions(inputs: {
  readonly verb: 'sign' | 'verify';
  readonly contractRef: string | undefined;
  readonly issues: readonly SchemaDiffIssue[];
}): readonly NextAction[] {
  const { verb, contractRef, issues } = inputs;
  const retryAfterEmit =
    contractRef === undefined
      ? `${verb} again`
      : `${verb} the emitted contract instead of "${contractRef}"`;
  const causes = new Set(issues.flatMap((issue) => issue.explanation?.cause ?? []));
  const drift =
    issues.length === 0 || issues.some((issue) => issue.explanation?.cause !== 'expected-refused');
  const uncaused = issues.length === 0 || issues.some((issue) => issue.explanation === undefined);
  return [
    ...[...causes]
      .sort((a, b) => CAUSE_ORDER[a] - CAUSE_ORDER[b])
      .map((cause) => causeAction(cause, retryAfterEmit)),
    ...(drift
      ? [
          runCommandAction(
            `Change the database to match the contract, then ${verb} again`,
            contractRef === undefined ? '{bin} db update' : `{bin} db update --to "${contractRef}"`,
          ),
        ]
      : []),
    ...(uncaused
      ? [
          chooseAction(
            causes.has('possibly-equivalent')
              ? `Or, for the issues with no explanation, change the contract source to describe the database as it is, re-run contract emit, then ${retryAfterEmit}`
              : `Or change the contract source to describe the database as it is, re-run contract emit, then ${retryAfterEmit}`,
          ),
        ]
      : []),
  ];
}

const CAUSE_ORDER: Record<MismatchCause, number> = {
  'expected-refused': 0,
  'possibly-equivalent': 1,
};

function causeAction(cause: MismatchCause, retryAfterEmit: string): NextAction {
  switch (cause) {
    case 'expected-refused':
      return runCommandAction(
        'Re-emit the contract: the emitted contract holds a value its type refuses, and re-emitting stores it as its type holds it',
        '{bin} contract emit',
      );
    case 'possibly-equivalent':
      return chooseAction(
        `If the database only stored a value in a form of its own, write it in the contract source as the database stores it, re-run contract emit, then ${retryAfterEmit}`,
      );
    default:
      return assertNever(cause, `Unhandled mismatch cause: ${String(cause)}`);
  }
}
