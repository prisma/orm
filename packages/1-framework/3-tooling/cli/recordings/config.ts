/**
 * CLI recording configuration.
 *
 * Defines VHS settings and recording scenarios for `prisma` CLI commands.
 * Run with: `npx tsx scripts/record.ts` from the CLI package directory.
 */

export interface VhsConfig {
  shell: string;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  padding: number;
  theme: string;
  typingSpeed: string;
  framerate: number;
  cursorBlink: boolean;
  windowBar: string;
  sleepAfterEnter: string;
}

export interface Recording {
  name: string;
  command: string;
  description?: string;
  sleepAfterEnter?: string;
  height?: 'dynamic' | number;
  /**
   * Database state required before recording:
   * - 'none': No database needed (e.g., --help commands)
   * - 'empty': Fresh empty database (for db init scenarios)
   * - 'initialized': Database initialized with base contract (for db update scenarios)
   */
  setup?: 'none' | 'empty' | 'initialized';
  /**
   * Contract fixture file to use for the recorded command.
   * Default: 'contract-base.ts'
   *
   * When setup is 'initialized', the database is always initialized with
   * 'contract-base.ts' first. If this field specifies a different contract,
   * the script swaps it in and re-emits before recording.
   */
  contract?: string;
}

// --- Journey types ---

/** Actions to run before a journey step's VHS recording. */
export type StepAction =
  | { type: 'swap-contract'; contract: string }
  | { type: 'emit-contract' }
  | { type: 'sql'; query: string };

export interface JourneyStep {
  /** Ordinal prefix for ordering, e.g., "01" */
  ordinal: string;
  /** Slug appended to ordinal, e.g., "contract-emit" */
  slug: string;
  /** The CLI command to record */
  command: string;
  /** Human-readable description of the action */
  description?: string;
  /** Short description of the database state before this step runs */
  dbState?: string;
  /** Actions to run before VHS records this step */
  before?: StepAction[];
  /** Override sleep after enter (default from VHS config) */
  sleepAfterEnter?: string;
  /** Fixed height override (default from VHS config). */
  height?: number;
}

export interface Journey {
  /**
   * How to set up the workspace before the first step.
   * - 'empty-db': Fresh workspace with contract source + config, empty database.
   * - 'initialized': Workspace + contract emitted + db init already run.
   */
  precondition: 'empty-db' | 'initialized';
  /** Contract fixture file for the workspace. Default: 'contract-base.ts' */
  contract?: string;
  /** Ordered steps — database state accumulates across steps (no reset between them). */
  steps: JourneyStep[];
}

export interface RecordingsConfig {
  vhs: VhsConfig;
  recordings: Record<string, Recording[]>;
  journeys: Record<string, Journey>;
}

export const config: RecordingsConfig = {
  vhs: {
    shell: 'bash',
    width: 1480,
    height: 750,
    fontSize: 16,
    fontFamily: 'JetBrains Mono',
    padding: 20,
    theme: 'Catppuccin Frappe',
    typingSpeed: '40ms',
    framerate: 30,
    cursorBlink: false,
    windowBar: 'Colorful',
    sleepAfterEnter: '8s',
  },

  recordings: {
    'db-init': [
      {
        name: 'help',
        description: 'Show db init help',
        command: 'prisma db init --help',
        height: 'dynamic',
        sleepAfterEnter: '3s',
      },
      {
        name: 'dry-run',
        description: 'Preview changes on empty database',
        command: 'prisma db init --dry-run',
        setup: 'empty',
        height: 'dynamic',
        sleepAfterEnter: '15s',
      },
      {
        name: 'apply',
        description: 'Initialize empty database',
        command: 'prisma db init',
        setup: 'empty',
        height: 'dynamic',
        sleepAfterEnter: '15s',
      },
    ],

    'db-update': [
      {
        name: 'help',
        description: 'Show db update help',
        command: 'prisma db update --help',
        height: 'dynamic',
        sleepAfterEnter: '3s',
      },
      {
        name: 'no-changes',
        description: 'No changes when database matches contract',
        command: 'prisma db update --dry-run',
        setup: 'initialized',
        height: 'dynamic',
        sleepAfterEnter: '15s',
      },
      {
        name: 'additive-dry-run',
        description: 'Preview additive schema changes',
        command: 'prisma db update --dry-run',
        setup: 'initialized',
        contract: 'contract-additive.ts',
        height: 'dynamic',
        sleepAfterEnter: '15s',
      },
    ],
  },

  journeys: {
    // --- Happy paths ---

    'greenfield-setup': {
      precondition: 'empty-db',
      contract: 'contract-base.ts',
      steps: [
        {
          ordinal: '01',
          slug: 'contract-emit',
          command: 'prisma contract emit',
          description: 'Emit contract.json + contract.d.ts',
          dbState: 'empty database, no contract yet',
          sleepAfterEnter: '5s',
        },
        {
          ordinal: '02',
          slug: 'db-init-dry-run',
          command: 'prisma db init --dry-run',
          description: 'Preview planned CREATE TABLE operations',
          dbState: 'empty database, contract emitted',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '03',
          slug: 'db-init',
          command: 'prisma db init',
          description: 'Create tables and write contract marker',
          dbState: 'empty database, contract emitted',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '04',
          slug: 'db-init-idempotent',
          command: 'prisma db init',
          description: 'Idempotent re-run — expects no changes',
          dbState: 'initialized, marker matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '05',
          slug: 'db-verify',
          command: 'prisma db verify',
          description: 'Verify marker and schema match contract',
          dbState: 'initialized, marker matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '06',
          slug: 'db-verify-schema-only',
          command: 'prisma db verify --schema-only',
          description: 'Verify schema satisfies contract without marker checks',
          dbState: 'initialized, schema matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '07',
          slug: 'db-verify-strict',
          command: 'prisma db verify --strict',
          description: 'Verify marker + schema in strict mode (no extras)',
          dbState: 'initialized, schema matches contract exactly',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '08',
          slug: 'db-introspect',
          command: 'prisma db schema',
          description: 'Inspect the live database schema tree',
          dbState: 'initialized with user(id, email)',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '09',
          slug: 'db-verify-json',
          command: 'prisma db verify --json',
          description: 'Verify marker + schema (JSON output for CI/agents)',
          dbState: 'initialized, marker matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '10',
          slug: 'db-verify-schema-only-json',
          command: 'prisma db verify --schema-only --json',
          description: 'Schema-only verification (JSON output for CI/agents)',
          dbState: 'initialized, schema matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '11',
          slug: 'contract-infer',
          command: 'prisma contract infer',
          description: 'Infer a PSL contract from the live database',
          dbState: 'initialized with user(id, email)',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '12',
          slug: 'contract-infer-cat',
          command: 'cat contract.prisma',
          description: 'View the inferred PSL contract',
          dbState: 'contract.prisma written by previous step',
          sleepAfterEnter: '5s',
        },
      ],
    },

    'direct-update': {
      precondition: 'initialized',
      contract: 'contract-base.ts',
      steps: [
        {
          ordinal: '01',
          slug: 'contract-emit-v2',
          command: 'prisma contract emit',
          description: 'Emit updated contract with new nullable column',
          dbState: 'initialized with base contract',
          before: [{ type: 'swap-contract', contract: 'contract-additive.ts' }],
          sleepAfterEnter: '5s',
        },
        {
          ordinal: '02',
          slug: 'db-update-dry-run',
          command: 'prisma db update --dry-run',
          description: 'Preview planned ADD COLUMN operation',
          dbState: 'initialized with base, contract is v2',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '03',
          slug: 'db-update-apply',
          command: 'prisma db update',
          description: 'Apply additive change, update marker',
          dbState: 'initialized with base, contract is v2',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '04',
          slug: 'db-update-noop',
          command: 'prisma db update',
          description: 'No-op — database already matches contract',
          dbState: 'updated to v2, marker matches',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '05',
          slug: 'db-verify',
          command: 'prisma db verify',
          description: 'Verify marker and schema match updated contract',
          dbState: 'updated to v2, marker matches',
          sleepAfterEnter: '10s',
        },
      ],
    },

    // --- Drift detection + recovery ---

    'drift-missing-marker': {
      precondition: 'empty-db',
      contract: 'contract-base.ts',
      steps: [
        {
          ordinal: '01',
          slug: 'db-verify-fail',
          command: 'prisma db verify',
          description: 'Verify fails — no marker, db init never run',
          dbState: 'empty database, contract emitted',
          before: [{ type: 'emit-contract' }],
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '02',
          slug: 'db-verify-schema-only-fail',
          command: 'prisma db verify --schema-only',
          description: 'Schema-only verify fails — no tables exist',
          dbState: 'empty database',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '03',
          slug: 'db-introspect-empty',
          command: 'prisma db schema',
          description: 'Schema inspection shows an empty database',
          dbState: 'empty database',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '04',
          slug: 'db-init-recovery',
          command: 'prisma db init',
          description: 'Recovery — initialize database from scratch',
          dbState: 'empty database, contract emitted',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '05',
          slug: 'db-verify-pass',
          command: 'prisma db verify',
          description: 'Verify passes after recovery',
          dbState: 'initialized, marker matches contract',
          sleepAfterEnter: '10s',
        },
      ],
    },

    'drift-stale-marker': {
      precondition: 'initialized',
      contract: 'contract-base.ts',
      steps: [
        {
          ordinal: '01',
          slug: 'db-verify-fail',
          command: 'prisma db verify',
          description: 'Verify fails — marker hash does not match new contract',
          dbState: 'initialized with base, contract swapped to v2',
          before: [
            { type: 'swap-contract', contract: 'contract-additive.ts' },
            { type: 'emit-contract' },
          ],
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '02',
          slug: 'db-verify-schema-only-fail',
          command: 'prisma db verify --schema-only',
          description: 'Schema-only verify fails — missing name column',
          dbState: 'base schema, v2 contract expects name column',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '03',
          slug: 'db-update-recovery',
          command: 'prisma db update',
          description: 'Recovery — apply pending change, update marker',
          dbState: 'base schema, v2 contract',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '04',
          slug: 'db-verify-pass',
          command: 'prisma db verify',
          description: 'Verify passes after recovery',
          dbState: 'updated to v2, marker matches',
          sleepAfterEnter: '10s',
        },
      ],
    },

    'drift-invalid-marker': {
      precondition: 'initialized',
      contract: 'contract-base.ts',
      steps: [
        {
          ordinal: '01',
          slug: 'db-verify-fail',
          command: 'prisma db verify',
          description: 'Verify fails — the live schema no longer matches the contract',
          dbState: 'manual DDL dropped email column, marker unchanged',
          before: [{ type: 'sql', query: 'ALTER TABLE "user" DROP COLUMN "email"' }],
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '02',
          slug: 'db-verify-marker-only-pass',
          command: 'prisma db verify --marker-only',
          description: 'Marker-only verification still passes when the marker row is unchanged',
          dbState: 'email column dropped, marker still matches contract',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '03',
          slug: 'db-introspect-diverged',
          command: 'prisma db schema',
          description: 'Schema inspection shows the missing email column',
          dbState: 'user table has only id column',
          sleepAfterEnter: '10s',
        },
        {
          ordinal: '04',
          slug: 'db-update-recovery',
          command: 'prisma db update',
          description: 'Recovery — re-add missing column, update marker',
          dbState: 'email column missing, contract expects it',
          sleepAfterEnter: '12s',
        },
        {
          ordinal: '05',
          slug: 'db-verify-schema-only-pass',
          command: 'prisma db verify --schema-only',
          description: 'Schema-only verification passes after recovery',
          dbState: 'schema restored, marker matches contract',
          sleepAfterEnter: '10s',
        },
      ],
    },
  },
};
