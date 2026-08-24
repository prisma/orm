import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
} from '@internal/framework-components/emission';
import { dirname } from 'pathe';
import {
  type AuthoringId,
  schemaSample,
  type TargetId,
  targetEntrypoint,
  targetPackageName,
} from './code-templates';
import { MIN_SERVER_VERSION, TARGET_LABEL } from './env';
import { renderTemplate } from './render';

export const variables = [
  'schemaPath',
  'schemaDir',
  'dbImportPath',
  'pkgRun',
  'pkg',
  'configEntrypoint',
  'schemaSample',
  'requirements',
] as const;

type TemplateVars = Record<(typeof variables)[number], string>;

export function quickReferenceMd(
  target: TargetId,
  authoring: AuthoringId,
  schemaPath: string,
  pkgRun: string,
  resolveImportSpecifier: ImportSpecifierResolver = keepInternalSpecifiers,
): string {
  const schemaDir = dirname(schemaPath);
  const pkg = targetPackageName(target, resolveImportSpecifier);
  const vars: TemplateVars = {
    schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun,
    pkg,
    configEntrypoint: targetEntrypoint(target, 'config', resolveImportSpecifier),
    schemaSample: schemaSample(target, authoring, resolveImportSpecifier),
    requirements: requirementsBlock(target),
  };
  const templateFile = `quick-reference-${target}.md`;
  return renderTemplate(templateFile, variables, vars);
}

/**
 * Renders the FR8.2 "Requirements" block injected into `prisma-next.md`
 * (the user-facing quick reference). Sources the minimum server
 * version from `MIN_SERVER_VERSION` — itself mirrored from each
 * target package's `package.json#prismaNext.minServerVersion`
 * (FR8.1).
 *
 * The verification command is target-specific — Postgres scaffolds
 * shouldn't ship Mongo's `db.runCommand` (and vice versa) just because
 * we couldn't be bothered to branch.
 */
function requirementsBlock(target: TargetId): string {
  const label = TARGET_LABEL[target];
  const minVersion = MIN_SERVER_VERSION[target];
  const verifyCommand =
    target === 'postgres' ? '`SELECT version()`' : '`db.runCommand({ buildInfo: 1 })`';
  return [
    '## Requirements',
    '',
    `- **${label} ${minVersion} or newer.** Older servers are not supported. Run ${verifyCommand} against your server to verify.`,
    '- The CLI never connects to your database without explicit consent. Pass `--probe-db` to `prisma orm init` if you want `init` to verify the server version itself.',
  ].join('\n');
}
