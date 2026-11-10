import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { expectAbsent, expectPresent } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import {
  rlsEnabledAst,
  rlsPolicyDefinitionAst,
  rlsPolicyExistsAst,
} from '../../../contract-free/checks';
import {
  alterPolicyRename,
  createPolicy,
  disableRowLevelSecurity as disableRowLevelSecurityDdl,
  dropPolicy,
} from '../../../contract-free/ddl';
import { postgresError } from '../../errors';
import type { PostgresRlsPolicy } from '../../postgres-rls-policy';
import { POLICY_COMMAND_SQL, policyRoleList } from '../../rls/canonicalize';
import { qualifyTableName } from '../planner-sql-checks';
import { type Op, step, targetDetails } from './shared';

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function validateRoleName(role: string): string {
  if (!PLAIN_IDENTIFIER.test(role)) {
    throw postgresError(
      'CONTRACT.ROLE_INVALID',
      `Invalid role name ${JSON.stringify(role)}: role names must be plain SQL identifiers matching ^[A-Za-z_][A-Za-z0-9_$]*$`,
      { meta: { role, reason: 'not-a-plain-identifier' } },
    );
  }
  return role;
}

/** The roles `pg_policies.roles` lists for a policy created for `roles`: the roles the `TO` clause names, which fold to lower case unquoted. Postgres ignores every other role when the clause names `public`. */
function catalogPolicyRoles(roles: readonly string[]): readonly string[] {
  const named = [...new Set(policyRoleList(roles).map((role) => role.toLowerCase()))];
  return named.includes('public') ? ['public'] : named;
}

export async function createRlsPolicy(
  schemaName: string,
  tableName: string,
  policy: PostgresRlsPolicy,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const validatedRoles = policy.roles.map(validateRoleName);
  const ddlNode = createPolicy({
    schema: schemaName,
    table: tableName,
    name: policy.name,
    permissive: policy.permissive,
    operation: policy.operation,
    roles: validatedRoles,
    ...ifDefined('using', policy.using),
    ...ifDefined('withCheck', policy.withCheck),
  });
  const checks = rlsPolicyExistsAst({
    schema: schemaName,
    table: tableName,
    policyName: policy.name,
  });
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const defined = await lowerer.lowerToExecuteRequest(
    rlsPolicyDefinitionAst({
      schema: schemaName,
      table: tableName,
      policyName: policy.name,
      command: POLICY_COMMAND_SQL[policy.operation],
      permissive: policy.permissive,
      roles: catalogPolicyRoles(validatedRoles),
    }),
  );
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policy.name}`,
    label: `Create RLS policy "${policy.name}" on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rlsPolicy', policy.name, schemaName, tableName),
    precheck: [
      step(
        `ensure RLS policy "${policy.name}" does not exist`,
        absent.sql,
        absent.params,
        expectAbsent(`RLS policy "${policy.name}" on "${tableName}"`),
      ),
    ],
    execute: [step(`create RLS policy "${policy.name}"`, execute.sql, execute.params)],
    postcheck: [
      step(
        `verify RLS policy "${policy.name}" exists with the planned command, roles and permissiveness`,
        defined.sql,
        defined.params,
      ),
    ],
  };
}

export async function dropRlsPolicy(
  schemaName: string,
  tableName: string,
  policyName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = dropPolicy({ schema: schemaName, table: tableName, name: policyName });
  const checks = rlsPolicyExistsAst({ schema: schemaName, table: tableName, policyName });
  const present = await lowerer.lowerToExecuteRequest(checks.policyPresent());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const absent = await lowerer.lowerToExecuteRequest(checks.policyAbsent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${policyName}.drop`,
    label: `Drop RLS policy "${policyName}" on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('rlsPolicy', policyName, schemaName, tableName),
    precheck: [
      step(
        `ensure RLS policy "${policyName}" exists`,
        present.sql,
        present.params,
        expectPresent(`RLS policy "${policyName}" on "${tableName}"`),
      ),
    ],
    execute: [step(`drop RLS policy "${policyName}"`, execute.sql, execute.params)],
    postcheck: [
      step(
        `verify RLS policy "${policyName}" is absent`,
        absent.sql,
        absent.params,
        expectAbsent(`RLS policy "${policyName}" on "${tableName}"`),
      ),
    ],
  };
}

export async function enableRowLevelSecurity(
  schemaName: string,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const checks = rlsEnabledAst(schemaName, tableName);
  const disabled = await lowerer.lowerToExecuteRequest(checks.rlsDisabled());
  const enabled = await lowerer.lowerToExecuteRequest(checks.rlsEnabled());
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}`,
    label: `Enable row-level security on "${tableName}"`,
    operationClass: 'additive',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [
      step(`check RLS is not already enabled on "${tableName}"`, disabled.sql, disabled.params),
    ],
    execute: [
      step(
        `enable row-level security on "${tableName}"`,
        `ALTER TABLE ${qualifyTableName(schemaName, tableName)} ENABLE ROW LEVEL SECURITY`,
      ),
    ],
    postcheck: [
      step(`verify row-level security is enabled on "${tableName}"`, enabled.sql, enabled.params),
    ],
  };
}

export async function disableRowLevelSecurity(
  schemaName: string,
  tableName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = disableRowLevelSecurityDdl({ schema: schemaName, table: tableName });
  const checks = rlsEnabledAst(schemaName, tableName);
  const enabled = await lowerer.lowerToExecuteRequest(checks.rlsEnabled());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const disabled = await lowerer.lowerToExecuteRequest(checks.rlsDisabled());
  return {
    id: `rowLevelSecurity.${schemaName}.${tableName}.disable`,
    label: `Disable row-level security on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('rowLevelSecurity', tableName, schemaName),
    precheck: [
      step(`check RLS is currently enabled on "${tableName}"`, enabled.sql, enabled.params),
    ],
    execute: [step(`disable row-level security on "${tableName}"`, execute.sql, execute.params)],
    postcheck: [
      step(
        `verify row-level security is disabled on "${tableName}"`,
        disabled.sql,
        disabled.params,
      ),
    ],
  };
}

export async function renameRlsPolicy(
  schemaName: string,
  tableName: string,
  oldPolicyName: string,
  newPolicyName: string,
  lowerer: ExecuteRequestLowerer,
): Promise<Op> {
  const ddlNode = alterPolicyRename({
    schema: schemaName,
    table: tableName,
    name: oldPolicyName,
    newName: newPolicyName,
  });
  const oldChecks = rlsPolicyExistsAst({
    schema: schemaName,
    table: tableName,
    policyName: oldPolicyName,
  });
  const newChecks = rlsPolicyExistsAst({
    schema: schemaName,
    table: tableName,
    policyName: newPolicyName,
  });
  const oldPresent = await lowerer.lowerToExecuteRequest(oldChecks.policyPresent());
  const execute = await lowerer.lowerToExecuteRequest(ddlNode);
  const newPresent = await lowerer.lowerToExecuteRequest(newChecks.policyPresent());
  const newAbsent = await lowerer.lowerToExecuteRequest(newChecks.policyAbsent());
  const oldAbsent = await lowerer.lowerToExecuteRequest(oldChecks.policyAbsent());
  return {
    id: `rlsPolicy.${schemaName}.${tableName}.${oldPolicyName}.rename`,
    label: `Rename RLS policy "${oldPolicyName}" to "${newPolicyName}" on "${tableName}"`,
    operationClass: 'widening',
    target: targetDetails('rlsPolicy', newPolicyName, schemaName, tableName),
    precheck: [
      step(
        `ensure RLS policy "${oldPolicyName}" exists`,
        oldPresent.sql,
        oldPresent.params,
        expectPresent(`RLS policy "${oldPolicyName}" on "${tableName}"`),
      ),
      step(
        `ensure RLS policy "${newPolicyName}" does not exist`,
        newAbsent.sql,
        newAbsent.params,
        expectAbsent(`RLS policy "${newPolicyName}" on "${tableName}"`),
      ),
    ],
    execute: [
      step(
        `rename RLS policy "${oldPolicyName}" to "${newPolicyName}"`,
        execute.sql,
        execute.params,
      ),
    ],
    postcheck: [
      step(
        `verify RLS policy "${newPolicyName}" exists`,
        newPresent.sql,
        newPresent.params,
        expectPresent(`RLS policy "${newPolicyName}" on "${tableName}"`),
      ),
      step(
        `verify RLS policy "${oldPolicyName}" no longer exists`,
        oldAbsent.sql,
        oldAbsent.params,
        expectAbsent(`RLS policy "${oldPolicyName}" on "${tableName}"`),
      ),
    ],
  };
}
