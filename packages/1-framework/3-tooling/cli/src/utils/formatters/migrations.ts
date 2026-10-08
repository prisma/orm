import type {
  MigrationPlannerConflict,
  OperationPreview,
} from '@internal/framework-components/control';
import type { AppliedStatementReport } from '../../control-api/statements/report-applied-statements';
import type { PerSpaceExecutionEntry } from '../../control-api/types';

/**
 * Render a single statement of an `OperationPreview` for the human-readable
 * preview block. SQL statements get a trailing `;` if missing so the rendered
 * preview is byte-identical to the legacy `string[]`-based renderer for SQL
 * targets. Other languages (`'mongodb-shell'`) render verbatim.
 */
export function renderPreviewStatement(text: string, language: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (language === 'sql') {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }
  return trimmed;
}

/**
 * Choose the header label for a preview block. SQL-only previews keep the
 * legacy `DDL preview` label so the rendered output is byte-identical to the
 * pre-aggregate SQL CLI; previews from any other family — or a mix that
 * includes any non-SQL language — use the family-agnostic `Operation preview`
 * label.
 *
 * An empty `statements` array deliberately renders as `Operation preview`
 * rather than `DDL preview`: `Array.prototype.every` is vacuously true for
 * empty arrays, but we have no evidence the preview is SQL-only when no
 * statements are present, so the family-agnostic label is the safer default.
 */
export function previewBlockHeader(preview: OperationPreview): string {
  const allSql =
    preview.statements.length > 0 && preview.statements.every((s) => s.language === 'sql');
  return allSql ? 'DDL preview' : 'Operation preview';
}

// ============================================================================
// Migration Command Output Formatters (shared by db init and db update)
// ============================================================================

/**
 * Shared CLI output type for migration commands (db init, db update).
 */
export interface MigrationCommandResult {
  readonly ok: true;
  readonly mode: 'plan' | 'apply';
  readonly plan: {
    readonly targetId: string;
    readonly destination: {
      readonly storageHash: string;
      readonly profileHash?: string;
    };
    readonly operations: readonly {
      readonly id: string;
      readonly label: string;
      readonly operationClass: string;
    }[];
    /**
     * Family-agnostic textual preview of the planned operations. Replaces the
     * previous `sql?: readonly string[]`. Consumers should read
     * `plan.preview?.statements`.
     */
    readonly preview?: OperationPreview;
  };
  readonly execution?: {
    readonly operationsPlanned: number;
    readonly operationsExecuted: number;
  };
  readonly marker?: {
    readonly storageHash: string;
    readonly profileHash?: string;
  };
  /**
   * Per-space execution breakdown in canonical schedule order
   * (extensions alphabetically, then app). Surfaces per-space markers
   * and the ops grouped by space, so the CLI summary can name which
   * space each op and marker belongs to instead of flattening them
   * into a single ambiguous list. See {@link PerSpaceExecutionEntry}.
   */
  readonly perSpace?: ReadonlyArray<PerSpaceExecutionEntry>;
  /** `db update` only: the `--rename` statements the plan applied, in order; empty when none were given. */
  readonly appliedStatements?: readonly AppliedStatementReport[];
  readonly advancedRef?: { readonly name: string; readonly hash: string } | null;
  readonly plannedAdvanceRef?: { readonly name: string; readonly hash: string } | null;
  readonly summary: string;
  readonly warnings?: readonly MigrationPlannerConflict[];
  readonly timings: {
    readonly total: number;
  };
}
