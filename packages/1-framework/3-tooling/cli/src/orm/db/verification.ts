import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  ExpectationFailureReason,
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { createControlStack, issueOutcome } from '@internal/framework-components/control';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import type { Block, TreeNode } from '@prisma/cli-engine';
import type { Diagnostic, NextAction, Result } from '@prisma/cli-engine/protocol';
import { CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import {
  errorConfigValidation,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFileNotFound,
  errorUnexpected,
} from '../../utils/cli-errors';
import { sanitizeErrorMessage } from '../../utils/command-helpers';
import { contractPathFor, displayPath } from '../migration/paths';
import { normalizeError } from '../normalize-error';

/** The contract both verification commands read, and where it was read from. */
export interface EmittedContract {
  readonly contract: Contract;
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
  const path = contractPathFor(inputs.config, inputs.cwd);
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
          : errorUnexpected(error instanceof Error ? error.message : String(error), {
              why: `Failed to read contract file: ${error instanceof Error ? error.message : String(error)}`,
            }),
      ),
    );
  }

  const familyInstance = inputs.config.family.create(createControlStack(inputs.config));
  try {
    return ok({
      contract: familyInstance.deserializeContract(castAs<unknown>(JSON.parse(content))),
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
  readonly invocation: string;
}): Result<string, CliStructuredError> {
  const dbConnection = inputs.db ?? inputs.config.db?.connection;
  if (typeof dbConnection !== 'string' || dbConnection.length === 0) {
    return notOk(
      normalizeError(
        errorDatabaseConnectionRequired({
          why: `Database connection is required for ${inputs.invocation} (set db.connection in prisma.config.ts, or pass --db <url>)`,
          missingFlags: ['--db'],
          retryCommand: `{bin} ${inputs.invocation} --db <url>`,
        }),
      ),
    );
  }
  if (inputs.config.driver === undefined) {
    return notOk(
      normalizeError(
        errorDriverRequired({ why: `Config.driver is required for ${inputs.invocation}` }),
      ),
    );
  }
  return ok(dbConnection);
}

/**
 * A failure the verification could not recover from — a dropped connection, a
 * driver throw — as a settlement the user can act on. Connection strings are
 * stripped from the prose whichever path the value took. A driver error
 * carrying `ECONNREFUSED`, `ENOTFOUND` or a SQLSTATE has a `code` and takes
 * the first path, and its message is exactly the one likely to quote the URL.
 */
export function verificationThrow(inputs: {
  readonly error: unknown;
  readonly invocation: string;
  readonly connection: string;
}): CliStructuredError {
  const { error } = inputs;
  const message = error instanceof Error ? error.message : String(error);
  const carriesCode = typeof error === 'object' && error !== null && 'code' in error;
  const normalized = carriesCode
    ? normalizeError(error)
    : normalizeError(
        errorUnexpected(message, {
          why: `Unexpected error during ${inputs.invocation}: ${message}`,
        }),
      );
  return withoutConnectionString(normalized, inputs.connection);
}

/**
 * The same envelope with the connection string stripped from every field the
 * settlement serializes: the prose, each next action's strings, and every
 * string reachable through `meta`. A driver error quotes the URL wherever it
 * pleases, so nothing user-facing passes through unstripped.
 */
function withoutConnectionString(
  error: CliStructuredError,
  connection: string,
): CliStructuredError {
  const clean = (text: string): string => sanitizeErrorMessage(text, connection);
  return new CliStructuredError(error.code, clean(error.message), {
    severity: error.severity,
    nextActions: error.nextActions.map((action) => cleanNextAction(action, clean)),
    ...ifDefined('why', error.why === undefined ? undefined : clean(error.why)),
    ...ifDefined('where', error.where),
    ...ifDefined('meta', error.meta === undefined ? undefined : cleanMetaRecord(error.meta, clean)),
    ...ifDefined('docsUrl', error.docsUrl),
    cause: error.cause,
  });
}

function cleanNextAction(action: NextAction, clean: (text: string) => string): NextAction {
  return {
    kind: action.kind,
    label: clean(action.label),
    ...ifDefined('command', action.command === undefined ? undefined : clean(action.command)),
    ...ifDefined('commands', action.commands?.map(clean)),
    ...ifDefined('url', action.url === undefined ? undefined : clean(action.url)),
    ...ifDefined('reason', action.reason === undefined ? undefined : clean(action.reason)),
  };
}

function cleanMetaValue(value: unknown, clean: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return clean(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cleanMetaValue(entry, clean));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cleanMetaValue(entry, clean)]),
    );
  }
  return value;
}

function cleanMetaRecord(
  meta: Record<string, unknown>,
  clean: (text: string) => string,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [key, cleanMetaValue(value, clean)]),
  );
}

const OUTCOME_LABEL: Record<ExpectationFailureReason, string> = {
  'not-found': 'missing',
  'not-expected': 'extra',
  'not-equal': 'mismatch',
};

/** What a diff issue says, in the words the commander shell used. */
export function issueLabel(issue: SchemaDiffIssue): string {
  return `${OUTCOME_LABEL[issueOutcome(issue)]}: ${issue.path.join('/')}`;
}

function issueNodes(issues: readonly SchemaDiffIssue[], status: 'error' | 'warn'): TreeNode[] {
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
    ...(issues.length === 0 ? {} : { why: `The live schema differs: ${issues.join('; ')}.` }),
    nextActions: inputs.nextActions,
    meta: {
      ...(inputs.space === undefined ? {} : { space: inputs.space }),
      issues,
      ...(dotted || code === undefined ? {} : { code }),
    },
  };
}
