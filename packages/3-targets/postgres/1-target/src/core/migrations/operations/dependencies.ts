import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { expectAbsent, expectPresent } from '@internal/framework-components/control';
import { extensionExistsAst, extensionInSchemaAst } from '../../../contract-free/checks';
import { DEFAULT_NAMESPACE_ID } from '../../namespace-ids';
import { quoteIdentifier } from '../../sql-utils';
import { type Op, step, targetDetails } from './shared';

/**
 * `CREATE EXTENSION … WITH SCHEMA …` for an extension the contract declares. The precheck states the extension is absent and the postcheck that it is present, so a run that finds it installed skips the operation.
 */
export async function createExtension(
  options: { readonly schema: string; readonly extension: string },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { schema, extension } = options;
  const checks = extensionExistsAst(extension);
  const absent = await lowerer.lowerToExecuteRequest(checks.extensionAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.extensionPresent());
  return {
    id: `extension.${extension}`,
    label: `Create extension "${extension}"`,
    operationClass: 'additive',
    target: targetDetails('dependency', extension, schema),
    precheck: [
      step(
        `verify extension "${extension}" is not installed`,
        absent.sql,
        absent.params,
        expectAbsent(`extension "${extension}"`),
      ),
    ],
    execute: [
      step(
        `create extension "${extension}"`,
        `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension)} WITH SCHEMA ${quoteIdentifier(schema)}`,
      ),
    ],
    postcheck: [
      step(
        `confirm extension "${extension}" is installed`,
        present.sql,
        present.params,
        expectPresent(`extension "${extension}"`),
      ),
    ],
  };
}

/** `DROP EXTENSION` without `CASCADE`: Postgres refuses it while any object depends on the extension. */
export async function dropExtension(
  options: { readonly schema: string; readonly extension: string },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { schema, extension } = options;
  const checks = extensionExistsAst(extension);
  const present = await lowerer.lowerToExecuteRequest(checks.extensionPresent());
  const absent = await lowerer.lowerToExecuteRequest(checks.extensionAbsent());
  return {
    id: `dropExtension.${extension}`,
    label: `Drop extension "${extension}"`,
    operationClass: 'destructive',
    target: targetDetails('dependency', extension, schema),
    precheck: [
      step(
        `verify extension "${extension}" is installed`,
        present.sql,
        present.params,
        expectPresent(`extension "${extension}"`),
      ),
    ],
    execute: [
      step(`drop extension "${extension}"`, `DROP EXTENSION ${quoteIdentifier(extension)}`),
    ],
    postcheck: [
      step(
        `confirm extension "${extension}" is dropped`,
        absent.sql,
        absent.params,
        expectAbsent(`extension "${extension}"`),
      ),
    ],
  };
}

/** `ALTER EXTENSION … SET SCHEMA`, which moves the extension's objects to another schema. */
export async function setExtensionSchema(
  options: { readonly extension: string; readonly schema: string },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { extension, schema } = options;
  const moved = await lowerer.lowerToExecuteRequest(extensionInSchemaAst(extension, schema));
  return {
    id: `setExtensionSchema.${extension}`,
    label: `Move extension "${extension}" to schema "${schema}"`,
    operationClass: 'widening',
    target: targetDetails('dependency', extension, schema),
    precheck: [],
    execute: [
      step(
        `move extension "${extension}" to schema "${schema}"`,
        `ALTER EXTENSION ${quoteIdentifier(extension)} SET SCHEMA ${quoteIdentifier(schema)}`,
      ),
    ],
    postcheck: [
      step(
        `confirm extension "${extension}" is in schema "${schema}"`,
        moved.sql,
        moved.params,
        expectPresent(`extension "${extension}" in schema "${schema}"`),
      ),
    ],
  };
}

/**
 * Install a Postgres extension as the baseline op for an extension-pack
 * contract space. Unlike {@link createExtension}, it stamps an
 * `invariantId` (required so the per-space marker records the install),
 * scopes the op `id` under a caller-chosen namespace (e.g. `pgvector.`),
 * and emits pre- and postcheck SQL probing `pg_extension`. The richer
 * shape lets the runner's idempotency probe skip the install on re-run
 * (postcheck-pre-satisfied) without firing the precheck.
 *
 * Use this for hand-rolled baseline migrations in contract-space
 * extension packages (e.g. `extension-pgvector`, `extension-paradedb`).
 */
export async function installExtension(
  options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  },
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const { extensionName, invariantId, id } = options;
  const label = options.label ?? `Enable extension "${extensionName}"`;
  const checks = extensionExistsAst(extensionName);
  const absent = await lowerer.lowerToExecuteRequest(checks.extensionAbsent());
  const present = await lowerer.lowerToExecuteRequest(checks.extensionPresent());
  return {
    id,
    label,
    operationClass: 'additive',
    invariantId,
    target: {
      id: 'postgres',
      details: { schema: DEFAULT_NAMESPACE_ID, objectType: 'dependency', name: extensionName },
    },
    precheck: [
      step(
        `verify extension "${extensionName}" is not already enabled`,
        absent.sql,
        absent.params,
        expectAbsent(`extension "${extensionName}"`),
      ),
    ],
    execute: [
      step(
        `create extension "${extensionName}"`,
        `CREATE EXTENSION IF NOT EXISTS ${extensionName}`,
      ),
    ],
    postcheck: [
      step(
        `confirm extension "${extensionName}" is enabled`,
        present.sql,
        present.params,
        expectPresent(`extension "${extensionName}"`),
      ),
    ],
  };
}
