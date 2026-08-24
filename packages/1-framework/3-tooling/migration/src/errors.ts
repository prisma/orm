import { CliStructuredError } from '@internal/errors/control';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@internal/utils/structured-error';
import { basename, dirname, relative } from 'pathe';
import type { MigrationGraph } from './graph';

/**
 * Build the canonical "re-emit this package" remediation hint.
 *
 * Every on-disk migration package ships its own `migration.ts` author-time
 * file. Running it regenerates `migration.json` and `ops.json` with the
 * correct hash + metadata, so it is the right primitive whenever a single
 * package's on-disk artifacts are missing, malformed, or otherwise corrupt.
 * Pointing users at `migration plan` would emit a *new* package rather than
 * heal the broken one.
 */
function reemitHint(dir: string, fallback?: string): string {
  const relativeDir = relative(process.cwd(), dir);
  const reemit = `Re-emit the package by running \`node "${relativeDir}/migration.ts"\``;
  return fallback ? `${reemit}, ${fallback}` : `${reemit}.`;
}

/**
 * Structured error for migration tooling operations.
 *
 * Follows the NAMESPACE.SUBCODE convention from ADR 027. All codes live under
 * the MIGRATION namespace. These are tooling-time errors (file I/O, hash
 * verification, migration history reconstruction), distinct from the runtime
 * MIGRATION.* codes for apply-time failures (PRECHECK_FAILED, POSTCHECK_FAILED,
 * etc.).
 *
 * Fields:
 * - code:     Stable machine-readable code (MIGRATION.SUBCODE)
 * - category: Always 'MIGRATION'
 * - why:      Explains the cause in plain language
 * - fix:      Actionable remediation step
 * - meta:     Machine-readable structured data for agents
 */
export class MigrationToolsError extends CliStructuredError {
  readonly category: 'MIGRATION';
  declare readonly code: `MIGRATION.${string}`;
  declare readonly why: string;
  declare readonly fix: string;

  constructor(
    code: `MIGRATION.${string}`,
    summary: string,
    options: {
      readonly why: string;
      readonly fix: string;
      readonly nextActions?: readonly NextAction[];
      readonly meta?: Record<string, unknown>;
      readonly cause?: unknown;
    },
  ) {
    super(code, summary, options);
    this.category = 'MIGRATION';
  }

  static override is(error: unknown): error is MigrationToolsError {
    return (
      CliStructuredError.is(error) &&
      'category' in error &&
      error.category === 'MIGRATION' &&
      error.code.startsWith('MIGRATION.')
    );
  }
}

export function errorDirectoryExists(dir: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.DIR_EXISTS', 'Migration directory already exists', {
    why: `The directory "${dir}" already exists. Each migration must have a unique directory.`,
    fix: 'Use --name to pick a different name, or delete the existing directory and re-run.',
    meta: { dir },
  });
}

export function errorMissingFile(file: string, dir: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.FILE_MISSING', `Missing ${file}`, {
    why: `Expected "${file}" in "${dir}" but the file does not exist.`,
    fix: reemitHint(
      dir,
      'or delete the directory if the migration is unwanted and the source TypeScript is gone.',
    ),
    meta: { file, dir },
  });
}

export function errorInvalidJson(filePath: string, parseError: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_JSON', 'Invalid JSON in migration file', {
    why: `Failed to parse "${filePath}": ${parseError}`,
    fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
    meta: { filePath, parseError },
  });
}

export function errorInvalidManifest(filePath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_MANIFEST', 'Invalid migration manifest', {
    why: `Migration manifest at "${filePath}" is invalid: ${reason}`,
    fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
    meta: { filePath, reason },
  });
}

export function errorDescribeMissingEndContract(): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DESCRIBE_INVALID',
    'Migration.describe(): provide endContractJson or override describe() — a migration needs a destination contract hash.',
    {
      why: 'Migration.describe() was called on a migration that carries no endContractJson and does not override describe(), so no destination contract hash can be derived.',
      fix: 'Set endContractJson on the migration, or override describe() to return the { from, to } metadata explicitly.',
      meta: { reason: 'missing-end-contract' },
    },
  );
}

export function errorDescribeInvalidMetadata(summary: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DESCRIBE_INVALID',
    `describe() returned invalid metadata: ${summary}`,
    {
      why: `The migration's describe() returned metadata that failed schema validation: ${summary}.`,
      fix: 'Ensure describe() returns { from: string | null, to: string } with valid contract hashes.',
      meta: { reason: 'invalid-metadata', summary },
    },
  );
}

export function errorOperationsNotArray(): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.PLAN_NOT_ARRAY', 'operations must be an array', {
    why: "The migration instance's `operations` getter returned a non-array value.",
    fix: 'Ensure the `operations` getter returns an array of migration operations.',
    meta: {},
  });
}

export function errorSpaceHeadRefMissing(spaceId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.CHECK_HEAD_REF_MISSING',
    `Contract space "${spaceId}" has no head ref; its contract cannot be resolved from the snapshot store without one.`,
    {
      why: `Contract space "${spaceId}" declares no refs/head.json, so there is no hash to resolve its contract against the snapshot store.`,
      fix: "Re-emit the contract-space migrations and head-ref artifacts (the extension's contract-space build), or restore refs/head.json from version control.",
      meta: { spaceId },
    },
  );
}

export function errorInvalidOperationEntry(index: number, reason: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.INVALID_OPERATION_ENTRY',
    'Migration operation entry is malformed',
    {
      why: `Operation at index ${index} returned by the migration class failed schema validation: ${reason}.`,
      fix: "Update the migration class so each entry of `operations` carries `id` (string), `label` (string), and `operationClass` (one of 'additive' | 'widening' | 'destructive' | 'data').",
      meta: { index, reason },
    },
  );
}

export function errorInvalidSlug(slug: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_NAME', 'Invalid migration name', {
    why: `The slug "${slug}" contains no valid characters after sanitization (only a-z, 0-9 are kept).`,
    fix: 'Provide a name with at least one alphanumeric character, e.g. --name add_users.',
    meta: { slug },
  });
}

export function errorInvalidDestName(destName: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_DEST_NAME', 'Invalid copy destination name', {
    why: `The destination name "${destName}" must be a single path segment (no ".." or directory separators).`,
    fix: 'Use a simple file name such as "contract.json" for each destination in the copy list.',
    meta: { destName },
  });
}

export function errorInvalidSpaceId(spaceId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.INVALID_SPACE_ID',
    'Invalid contract space identifier',
    {
      why: `The space id "${spaceId}" does not match the required pattern /^[a-z][a-z0-9_-]{0,63}$/. Space ids are used as filesystem directory names under \`migrations/\`, so the pattern is conservative on purpose.`,
      fix: 'Pick a lowercase identifier that begins with a letter and contains only lowercase letters, digits, hyphens, or underscores; max 64 characters total.',
      meta: { spaceId },
    },
  );
}

export function errorDescriptorHeadHashMismatch(args: {
  readonly extensionId: string;
  readonly recomputedHash: string;
  readonly headRefHash: string;
}): MigrationToolsError {
  const { extensionId, recomputedHash, headRefHash } = args;
  return new MigrationToolsError(
    'MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH',
    "Extension descriptor's headRef.hash does not match its contractJson",
    {
      why: `Extension "${extensionId}" publishes a \`contractSpace\` whose \`headRef.hash\` (${headRefHash}) does not match the canonical hash recomputed from \`contractSpace.contractJson\` (${recomputedHash}). This means the extension descriptor was published with stale \`headRef.hash\` — typically because the contract was bumped without rerunning the extension's emit pipeline.`,
      fix: 'Re-run the extension authoring pipeline so `contractJson.storage.storageHash` and `headRef.hash` agree, then republish the extension. If you are the extension author and you intentionally bumped `contractJson`, recompute and update `headRef.hash` (and refresh any on-disk migration metadata that derives from it).',
      meta: { extensionId, recomputedHash, headRefHash },
    },
  );
}

export function errorDuplicateSpaceId(spaceId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_SPACE_ID',
    'Duplicate contract space identifier',
    {
      why: `The space id "${spaceId}" appears more than once in the per-space planner input. Each space id must be unique across the inputs (the per-space planner emits one output entry per id).`,
      fix: 'Deduplicate the inputs before passing them to `planAllSpaces` — typically by checking your `extensions` declaration for repeated entries.',
      meta: { spaceId },
    },
  );
}

export function errorSameSourceAndTarget(dir: string, hash: string): MigrationToolsError {
  const dirName = basename(dir);
  return new MigrationToolsError(
    'MIGRATION.SAME_SOURCE_AND_TARGET',
    'Migration without data-transform operations has same source and target',
    {
      why: `Migration "${dirName}" has from === to === "${hash}" and declares no data-transform operations. Self-edges are only allowed when the migration runs at least one dataTransform — otherwise the migration is a no-op.`,
      fix: reemitHint(
        dir,
        'and either change the contract so from ≠ to, add a dataTransform op, or delete the directory if the migration is unwanted.',
      ),
      meta: { dirName, hash },
    },
  );
}

export function errorAmbiguousTarget(
  branchTips: readonly string[],
  context?: {
    divergencePoint: string;
    branches: readonly {
      tip: string;
      edges: readonly { dirName: string; from: string; to: string }[];
    }[];
  },
): MigrationToolsError {
  const divergenceInfo = context
    ? `\nDivergence point: ${context.divergencePoint}\nBranches:\n${context.branches.map((b) => `  → ${b.tip} (${b.edges.length} edge(s): ${b.edges.map((e) => e.dirName).join(' → ') || 'direct'})`).join('\n')}`
    : '';
  return new MigrationToolsError('MIGRATION.AMBIGUOUS_TARGET', 'Ambiguous migration target', {
    why: `The migration history has diverged into multiple branches: ${branchTips.join(', ')}. This typically happens when two developers plan migrations from the same starting point.${divergenceInfo}`,
    fix: 'Use `{bin} migration ref set <name> <hash>` to target a specific branch, delete one of the conflicting migration directories and re-run `{bin} migration plan`, or use --from <hash> to explicitly select a starting point.',
    meta: {
      branchTips,
      ...(context ? { divergencePoint: context.divergencePoint, branches: context.branches } : {}),
    },
  });
}

export function errorNoInitialMigration(nodes: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.NO_INITIAL_MIGRATION', 'No initial migration found', {
    why: `No migration starts from the empty contract state (known hashes: ${nodes.join(', ')}). At least one migration must originate from the empty state.`,
    fix: 'Inspect the migrations directory for corrupted migration.json files. At least one migration must start from the empty contract hash.',
    meta: { nodes },
  });
}

export function errorInvalidRefs(refsPath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REFS', 'Invalid refs.json', {
    why: `refs.json at "${refsPath}" is invalid: ${reason}`,
    fix: 'Ensure refs.json is a flat object mapping valid ref names to contract hash strings.',
    meta: { path: refsPath, reason },
  });
}

export function errorInvalidRefFile(filePath: string, reason: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_FILE', 'Invalid ref file', {
    why: `Ref file at "${filePath}" is invalid: ${reason}`,
    fix: 'Ensure the ref file contains valid JSON with { "hash": "<64 hex chars>", "invariants": ["..."] }.',
    meta: { path: filePath, reason },
  });
}

export function errorInvalidRefName(refName: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_NAME', 'Invalid ref name', {
    why: `Ref name "${refName}" is invalid. Names must be lowercase alphanumeric with hyphens or forward slashes (no "." or ".." segments).`,
    fix: `Use a valid ref name (e.g., "staging", "envs/production").`,
    meta: { refName },
  });
}

export function errorNoTarget(reachableHashes: readonly string[]): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.NO_TARGET', 'No migration target could be resolved', {
    why: `The migration history contains cycles and no target can be resolved automatically (reachable hashes: ${reachableHashes.join(', ')}). This typically happens after rollback migrations (e.g., C1→C2→C1).`,
    fix: 'Use --from <hash> to specify the planning origin explicitly.',
    meta: { reachableHashes },
  });
}

export function errorInvalidRefValue(value: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_REF_VALUE', 'Invalid ref value', {
    why: `Ref value "${value}" is not a valid contract hash. Values must be a 64-character hex digest or "empty".`,
    fix: 'Use a valid storage hash from `{bin} contract emit` output or an existing migration.',
    nextActions: [
      {
        kind: 'run-command',
        label: 'Emit the contract to obtain a valid storage hash',
        command: '{bin} contract emit',
      },
      {
        kind: 'run-command',
        label: 'List existing migrations to reuse one of their hashes',
        command: '{bin} migration list',
      },
    ],
    meta: { value },
  });
}

export function errorDuplicateMigrationHash(migrationHash: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_MIGRATION_HASH',
    'Duplicate migrationHash in migration graph',
    {
      why: `Multiple migrations share migrationHash "${migrationHash}". Each migration must have a unique content-addressed identity.`,
      fix: 'Regenerate one of the conflicting migrations so each migrationHash is unique, then re-run migration commands.',
      meta: { migrationHash },
    },
  );
}

export function errorInvalidInvariantId(invariantId: string): MigrationToolsError {
  return new MigrationToolsError('MIGRATION.INVALID_INVARIANT_ID', 'Invalid invariantId', {
    why: `invariantId ${JSON.stringify(invariantId)} is invalid. Ids must be non-empty and contain no whitespace or control characters (including Unicode whitespace like NBSP); other content (kebab-case, camelCase, namespaced, Unicode letters) is allowed.`,
    fix: 'Pick an invariantId without spaces, tabs, newlines, or control characters — e.g. "backfill-user-phone", "users/backfill-phone", or "BackfillUserPhone".',
    meta: { invariantId },
  });
}

export function errorDuplicateInvariantInEdge(invariantId: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.DUPLICATE_INVARIANT_IN_EDGE',
    'Duplicate invariantId on a single migration',
    {
      why: `invariantId "${invariantId}" is declared by more than one dataTransform on the same migration. The marker stores invariants as a set and the routing layer treats them as edge-level, so two ops cannot share a routing identity.`,
      fix: 'Rename one of the conflicting dataTransform invariantIds, or drop invariantId on the op that does not need to be routing-visible.',
      meta: { invariantId },
    },
  );
}

export function errorProvidedInvariantsMismatch(
  filePath: string,
  stored: readonly string[],
  derived: readonly string[],
): MigrationToolsError {
  const storedSet = new Set(stored);
  const derivedSet = new Set(derived);
  const missing = [...derivedSet].filter((id) => !storedSet.has(id));
  const extra = [...storedSet].filter((id) => !derivedSet.has(id));
  // When sets agree but arrays don't, the only difference is ordering — call
  // it out so the reader doesn't stare at two visually-identical arrays.
  // Canonical providedInvariants is sorted ascending; a manifest with the
  // same ids in a different order is still a mismatch (the hash check would
  // also fail), but the human-readable diagnostic is otherwise unhelpful.
  const orderingOnly = missing.length === 0 && extra.length === 0;
  const why = orderingOnly
    ? `migration.json at "${filePath}" stores providedInvariants ${JSON.stringify(stored)}, but the canonical value derived from ops.json is ${JSON.stringify(derived)} — same ids, different order. Canonical providedInvariants is sorted ascending.`
    : `migration.json at "${filePath}" stores providedInvariants ${JSON.stringify(stored)}, but the value derived from ops.json is ${JSON.stringify(derived)}. The manifest copy was likely hand-edited without re-emitting.`;
  return new MigrationToolsError(
    'MIGRATION.PROVIDED_INVARIANTS_MISMATCH',
    'providedInvariants on migration.json disagrees with ops.json',
    {
      why,
      fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
      meta: { filePath, stored, derived, difference: { missing, extra } },
    },
  );
}

/**
 * Wire-shape edge surfaced through the JSON envelope's
 * `meta.structuralPath` of `MIGRATION.NO_INVARIANT_PATH`. Slim by design —
 * authoring metadata (`createdAt`) lives on `MigrationEdge` but is
 * intentionally dropped here so the envelope stays stable across
 * graph-internal refactors.
 *
 * Stability: any field added here is part of the public CLI JSON contract.
 * Callers (CLI consumers, agents) must be able to treat
 * `(dirName, migrationHash, from, to, invariants)` as the canonical shape.
 */
export interface NoInvariantPathStructuralEdge {
  readonly dirName: string;
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
  readonly invariants: readonly string[];
}

export function errorNoInvariantPath(args: {
  readonly refName?: string;
  readonly required: readonly string[];
  readonly missing: readonly string[];
  readonly structuralPath: readonly NoInvariantPathStructuralEdge[];
}): MigrationToolsError {
  const { refName, required, missing, structuralPath } = args;
  const refClause = refName ? `Ref "${refName}"` : 'Target';
  const missingList = missing.map((id) => JSON.stringify(id)).join(', ');
  const requiredList = required.map((id) => JSON.stringify(id)).join(', ');
  return new MigrationToolsError(
    'MIGRATION.NO_INVARIANT_PATH',
    'No path covers the required invariants',
    {
      why: `${refClause} requires invariants the reachable path doesn't cover. required=[${requiredList}], missing=[${missingList}].`,
      fix: 'Add a migration on the path that runs `dataTransform({ invariantId: "<id>", … })` for each missing invariant, or retarget the ref to a hash whose path already provides them.',
      meta: {
        required,
        missing,
        structuralPath,
        ...ifDefined('refName', refName),
      },
    },
  );
}

export function errorUnknownInvariant(args: {
  readonly refName?: string;
  readonly unknown: readonly string[];
  readonly declared: readonly string[];
}): MigrationToolsError {
  const { refName, unknown, declared } = args;
  const refClause = refName ? `Ref "${refName}" declares` : 'Declares';
  const unknownList = unknown.map((id) => JSON.stringify(id)).join(', ');
  return new MigrationToolsError(
    'MIGRATION.UNKNOWN_INVARIANT',
    'Ref declares invariants no migration in the graph provides',
    {
      why: `${refClause} invariants no migration in the graph provides. unknown=[${unknownList}].`,
      fix: 'Either the ref has a typo, or the declaring migration has not been authored/attested yet. Re-check the ref file and the migrations directory.',
      meta: {
        unknown,
        declared,
        ...ifDefined('refName', refName),
      },
    },
  );
}

export function errorMigrationHashMismatch(
  dir: string,
  storedHash: string,
  computedHash: string,
): MigrationToolsError {
  // Render a cwd-relative path in the human-readable diagnostic so users
  // running CLI commands from the project root see a familiar short path.
  // Keep the absolute path in `meta.dir` for machine consumers.
  const relativeDir = relative(process.cwd(), dir);
  return new MigrationToolsError('MIGRATION.HASH_MISMATCH', 'Migration package is corrupt', {
    why: `Stored migrationHash "${storedHash}" does not match the recomputed hash "${computedHash}" for "${relativeDir}". The migration.json or ops.json has been edited or partially written since emit.`,
    fix: reemitHint(dir, 'or restore the directory from version control.'),
    meta: { dir, storedHash, computedHash },
  });
}

/**
 * A ref name that resolves to nothing: no pointer file named `refName`
 * exists, and the hash being resolved (the `contractAt` argument, used as a
 * fallback when the pointer is absent) is not a node in the migration graph
 * either. There is no contract to materialize.
 */
export function errorRefNotResolvable(refName: string): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.REF_NOT_RESOLVABLE',
    `Ref "${refName}" is not resolvable`,
    {
      why: `Ref "${refName}" has no pointer file, and the hash being resolved is not a node in the migration graph either — there is nothing to materialize a contract from.`,
      fix: `Create the ref with "{bin} migration ref set ${refName} <hash>" (or advance it via "{bin} db update --advance-ref ${refName}"), or pass a hash that is a node in the migration graph.`,
      nextActions: [
        {
          kind: 'run-command',
          label: `Create the ref "${refName}"`,
          command: `{bin} migration ref set ${refName} <hash>`,
        },
        {
          kind: 'run-command',
          label: `Advance the ref "${refName}" as part of an update`,
          command: `{bin} db update --advance-ref ${refName}`,
        },
        {
          kind: 'user-choice',
          label: 'Pass a hash that is already a node in the migration graph',
        },
      ],
      meta: { refName, identifier: refName },
    },
  );
}

export function errorBundleNotFoundForGraphNode(
  hash: string,
  explicitLabel?: string,
): MigrationToolsError {
  const summary = explicitLabel
    ? `No migration bundle found for reference "${explicitLabel}" (resolved hash: ${hash})`
    : `No migration bundle found for graph node ${hash}`;
  return new MigrationToolsError('MIGRATION.BUNDLE_NOT_FOUND_FOR_GRAPH_NODE', summary, {
    why: `The hash ${hash} is a graph node but no on-disk migration package has a destination (\`to\`) hash matching it.`,
    fix: 'Provide a ref or hash that corresponds to an existing migration package, or run `{bin} migration list` to see available migrations.',
    meta: { hash, ...(explicitLabel ? { explicitLabel } : {}) },
  });
}

export function errorContractDeserializationFailed(
  filePath: string,
  message: string,
  options?: { readonly cause?: unknown },
): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.CONTRACT_DESERIALIZATION_FAILED',
    'Contract failed to deserialize',
    {
      why: `Contract at "${filePath}" failed to deserialize: ${message}`,
      fix: reemitHint(dirname(filePath), 'or restore the directory from version control.'),
      meta: { filePath, message },
      ...ifDefined('cause', options?.cause),
    },
  );
}

export function errorHashNotInGraph(hash: string, graph: MigrationGraph): MigrationToolsError {
  const reachableHashes = [...graph.nodes].sort();
  const reachableList = reachableHashes.length > 0 ? reachableHashes.join(', ') : '(none)';
  return new MigrationToolsError(
    'MIGRATION.HASH_NOT_IN_GRAPH',
    `Hash "${hash}" is not a node in the migration graph`,
    {
      why: `The migration graph contains nodes ${reachableList}; "${hash}" isn't one of them.`,
      fix: `Pass a hash that's the from-or-to of an on-disk migration bundle, use --from with a graph-node hash, or run "{bin} migration plan" to introduce it.`,
      nextActions: [
        {
          kind: 'user-choice',
          label:
            'Pass a hash that is the from-or-to of an on-disk migration bundle, or use --from with a graph-node hash',
          reason: `Graph nodes: ${reachableList}.`,
        },
        {
          kind: 'run-command',
          label: `Introduce "${hash}" by planning a migration for it`,
          command: '{bin} migration plan',
        },
      ],
      meta: { hash, reachableHashes },
    },
  );
}

export function errorContractSnapshotMissing(
  storageHash: string,
  expectedPath: string,
): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.CONTRACT_SNAPSHOT_MISSING',
    'Contract snapshot is missing',
    {
      why: `Expected a contract snapshot for ${storageHash} at "${expectedPath}" but the file does not exist.`,
      fix: "Re-emit the contract snapshot by re-running the command that authored the migration referencing this hash (`{bin} migration plan` for app-space migrations; the extension's contract-space build for extension spaces), or restore migrations/snapshots/ from version control.",
      nextActions: [
        {
          kind: 'run-command',
          label: 'Re-emit the snapshot for an app-space migration',
          command: '{bin} migration plan',
        },
        {
          kind: 'user-choice',
          label: "For an extension space, re-run that extension's contract-space build instead",
        },
        {
          kind: 'user-choice',
          label: 'Restore migrations/snapshots/ from version control',
        },
      ],
      meta: { storageHash, expectedPath },
    },
  );
}

export function errorContractSnapshotHashMismatch(
  storageHash: string,
  actualHash: string,
  dir: string,
): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.CONTRACT_SNAPSHOT_HASH_MISMATCH',
    'Contract snapshot hash mismatch',
    {
      why: `The contract JSON's inner storage.storageHash ("${actualHash}") does not match the requested storage hash ("${storageHash}") for snapshot directory "${dir}".`,
      fix: 'Pass a contractJson whose storage.storageHash equals the storageHash argument passed to writeContractSnapshot — the two must agree by construction.',
      meta: { storageHash, actualHash, dir },
    },
  );
}

export function errorMigrationContractViewMissing(
  className: string,
  accessor: 'endContract' | 'startContract',
  jsonField: 'endContractJson' | 'startContractJson',
): MigrationToolsError {
  return new MigrationToolsError(
    'MIGRATION.CONTRACT_VIEW_MISSING',
    `${className}.${accessor} requires ${jsonField}`,
    {
      why: `${className}.${accessor} was read, but this instance has no ${jsonField} to build the view from.`,
      fix: `Set ${jsonField} to the migration's committed contract JSON, or avoid reading ${accessor} on a migration that overrides describe() and carries no contract.`,
      meta: { className, accessor, jsonField },
    },
  );
}
