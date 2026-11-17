# CLI Recording

Animated SVG and plain-text ASCII recordings of `prisma` CLI commands, produced by [VHS](https://github.com/charmbracelet/vhs).

## Prerequisites

| Dependency | Install |
|---|---|
| VHS | `brew install charmbracelet/tap/vhs` |
| CLI built | `pnpm build` from monorepo root |
| JetBrains Mono (MP4 only) | `brew install --cask font-jetbrains-mono` |

## Quick start

```bash
# 1. Start PostgreSQL (from monorepo root)
docker compose up -d

# 2. Record (builds automatically via turbo dependency)
pnpm record                                  # per-command recordings
pnpm record -- --journey greenfield-setup    # single journey
pnpm record -- --all-journeys               # all journeys in parallel
pnpm record -- --journey greenfield-setup --mp4  # also emit MP4
```

The PostgreSQL instance runs on port **5433** (not the default 5432) to avoid conflicts. Override with `DATABASE_URL`:

```bash
DATABASE_URL=postgres://user:pass@host:port/db pnpm record -- --all-journeys
```

## Why a real PostgreSQL?

VHS spawns the CLI in a separate process tree. PGlite only accepts connections from the process that started it, so it rejects VHS-spawned processes. A real PostgreSQL instance is required.

## How it works

### Recording tool

[VHS](https://github.com/charmbracelet/vhs) reads a `.tape` file — a script of terminal commands and timing — and renders animated SVG, ASCII, and optionally MP4 output. Think of it as a headless terminal recorder.

### Pipeline

```
recordings/config.ts          Defines scenarios (commands, db state, timing)
        │
        ▼
scripts/record.ts             Orchestrator:
   1. Validates prerequisites (vhs on PATH, CLI built)
   2. Creates shell wrapper scripts (.bin/) so VHS can find `prisma`
   3. Sets up database state per scenario (reset, emit, init)
   4. Generates .tape files from config
   5. Runs `vhs <tape>` to produce output
        │
        ├──▶ recordings/svgs/<group>/<name>.svg     Animated terminal recording
        ├──▶ recordings/ascii/<group>/<name>.ascii   Plain-text capture
        └──▶ recordings/mp4/<group>/<name>.mp4       Video (with --mp4 flag)
```

### Two recording modes

**Per-command** — isolated recordings of individual CLI commands. Each recording gets a fresh database state. Groups: `db-init`, `db-update`.

**Journey** — multi-step scenarios where database state accumulates across steps (no reset between them). Each step produces its own SVG/ASCII, named with an ordinal prefix (`01-contract-emit.svg`, `02-db-init.svg`, etc.).

Journeys:

| Slug | Description |
|---|---|
| `greenfield-setup` | Full setup from empty database: emit, init, verify, introspect |
| `direct-update` | Additive schema change via `db update` |
| `drift-missing-marker` | No marker in database, recovery via `db init` |
| `drift-stale-marker` | Marker hash mismatch after contract change, recovery via `db update` |
| `drift-invalid-marker` | Manual DDL drops a column while the marker stays unchanged; `db verify --marker-only` isolates the marker check |

### Database setup per recording

Each recording declares a `setup` level:

- **`none`** — no database needed (e.g., `--help` commands)
- **`empty`** — fresh empty database with contract emitted
- **`initialized`** — database initialized with base contract (tables created, marker written)

Journey steps can also run pre-step actions: swap contract fixture, emit contract, or execute raw SQL.

### Dynamic height

Recordings can set `height: 'dynamic'`. The script does a **probe pass** — records at 2x height, parses the SVG to find the last frame's max Y coordinate, and re-records at the optimal height. This avoids excess whitespace.

### VHS configuration

All recordings share a common VHS config defined in `recordings/config.ts`:

- Shell: `bash`
- Dimensions: 1480 x 750 (default, overridable per recording)
- Font: JetBrains Mono 16px
- Theme: Catppuccin Frappe
- Typing speed: 40ms per character
- Framerate: 30fps

### Parallel execution

`--all-journeys` creates one PostgreSQL database per journey (up to 4 concurrent) and records them in parallel.

## File layout

```
recordings/
├── config.ts           # All recording/journey definitions
├── fixtures/           # Contract source files and config template
│   ├── contract-base.ts
│   ├── contract-additive.ts
│   └── prisma.config.ts
├── ascii/              # Plain-text output (committed)
│   ├── db-init/
│   ├── db-update/
│   ├── greenfield-setup/
│   └── ...
├── svgs/               # Animated SVGs (committed)
├── tapes/              # Generated .tape scripts (committed)
├── mp4/                # MP4 output (gitignored)
└── .bin/               # Shell wrappers for VHS (gitignored)
```

## Caching

Two layers of caching avoid redundant VHS runs:

### Layer 1: turbo (coarse, task-level)

Turbo hashes the recording infrastructure (`scripts/record.ts`, `recordings/config.ts`, `recordings/fixtures/**`) plus the CLI's `dist/**` (transitively via `dependsOn: ["build"]`). If nothing changed, turbo replays cached `svgs/` and `ascii/` instantly — no VHS, no PostgreSQL.

### Layer 2: per-recording probe (fine-grained, per-command only)

When turbo's cache misses (e.g., CLI source changed), the script still skips individual recordings whose output hasn't changed. Before each per-command recording, it runs the CLI command directly (no VHS, no sleeps — ~1s) and hashes the output. If the hash matches `.cache.json` and the SVG/ASCII files exist, VHS is skipped for that recording.

This means: if you changed `db update` logic but not `db init`, only the `db update` recordings re-run.

Journey recordings always re-record when turbo misses, since steps have accumulated database state that can't be probed independently.

### Bypassing cache

```bash
pnpm record --force                         # bypass turbo cache (layer 1)
pnpm record -- --no-cache                   # bypass per-recording cache (layer 2)
pnpm record --force -- --no-cache           # bypass both
```

## Adding a recording

1. Edit `recordings/config.ts`.
2. For per-command recordings, add an entry to `config.recordings[group]`.
3. For journeys, add steps to `config.journeys[slug]` or add a new journey.
4. Run the recording script. The tape file, SVG, and ASCII are generated automatically.

## Fixtures

Two contract fixtures drive all recordings:

- **`contract-base.ts`** — a `user` table with `id` (int4) and `email` (text) columns
- **`contract-additive.ts`** — extends base with a nullable `name` column (used for update scenarios)
- **`prisma.config.ts`** — config template; `{{DB_URL}}` is replaced at runtime with the connection string
