# Telemetry

The ORM's CLI commands (`prisma orm ...`) send a small, anonymous usage event each time you run one. The team uses this data to answer adoption questions — how many people are actively using Prisma Next, which databases they target, which extensions get adopted, and how often the CLI is invoked by AI coding agents versus humans.

Telemetry is **on by default (opt-out)**. On the first command that would send an event — including the very first `prisma orm init` — the CLI prints a one-time notice to stderr telling you telemetry is enabled and exactly how to turn it off. There is no interactive consent prompt; the first-run notice is the single disclosure for every command. You can opt out at any time and the opt-out is honoured immediately — see [How to opt out (or back in)](#how-to-opt-out-or-back-in).

If you want to turn it off right now, jump to [How to opt out (or back in)](#how-to-opt-out-or-back-in).

## What is collected

Every event is a single JSON object with the fields below. Nothing else is sent.

| Field | Type | Example | Source |
| --- | --- | --- | --- |
| `installationId` | string (v4 UUID) | `"7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f"` | A random UUID generated and stored locally on the first enabled send |
| `version` | string | `"0.10.0"` | The version of the ORM toolchain you're running |
| `command` | string | `"migration new"` | The CLI command name, space-separated subcommands included |
| `flags` | string[] | `["name", "dry-run"]` | The **names** of the flags you passed, with the `--` prefix stripped |
| `runtimeName` | string | `"node"` | `"node"`, `"bun"`, or `"deno"` |
| `runtimeVersion` | string | `"24.13.0"` | The runtime's reported version |
| `os` | string | `"darwin"` | From Node's `process.platform` |
| `arch` | string | `"arm64"` | From Node's `process.arch` |
| `packageManager` | string \| null | `"pnpm/10.27.0"` | Parsed from the `npm_config_user_agent` env var your package manager sets when invoking the CLI |
| `databaseTarget` | string \| null | `"postgres"` | The `target.targetId` field from your `prisma.config.ts`, if a config is loaded |
| `tsVersion` | string \| null | `"5.9.3"` | The TypeScript version declared in your project's `package.json`, if readable |
| `agent` | string \| null | `"claude"` | The detected AI coding agent, or `null`. See [Agent detection](#agent-detection) |
| `extensions` | string[] | `["pgvector"]` | The `.id` values of the `extensions` declared in your config |

A server-side ingestion timestamp is added when the backend stores the event; no client clock is transmitted.

## What is not collected

Telemetry deliberately excludes anything that could identify you, your machine, your project, or the values you pass on the command line:

- **No flag values.** Only flag names. `--connection-string="postgres://user:pass@host"` becomes `["connection-string"]` on the wire — never the URL.
- **No positional arguments.** Subcommand names are reported; positional inputs are dropped.
- **No file paths.** Not absolute paths, not relative paths, not paths embedded in flag values.
- **No usernames, hostnames, IP addresses, MAC addresses, or machine identifiers.** The installation UUID is a freshly-generated random value, never derived from anything about your system. Resetting it is as simple as deleting one file.
- **No environment variable values.** Some env vars are *read* to populate fields (`npm_config_user_agent` for the package manager string, the agent markers below for `agent`), but their values never leave your machine in raw form. The one exception is the opt-in `AI_AGENT` variable, whose whole purpose is to carry the agent name that gets reported — see [Agent detection](#agent-detection).
- **No project source code, no schema contents, no migration contents.**
- **No outcome data.** Phase 1 does not collect success/failure, exit code, or elapsed time.

## The user-level config file

Your telemetry preference and the installation UUID live in a single per-user JSON file:

- **Unix (Linux, macOS):** `$XDG_CONFIG_HOME/prisma-next/config.json`, defaulting to `~/.config/prisma-next/config.json` when `$XDG_CONFIG_HOME` is unset. This follows the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
- **Windows:** `%APPDATA%\prisma-next\config.json`, falling back to `%USERPROFILE%\AppData\Roaming\prisma-next\config.json`.

The CLI writes this file for you: `prisma telemetry enable` / `disable` set the preference, and `prisma telemetry status` prints the resolved path along with what's currently in effect. The rest of this section describes what the file contains so you can read it; [changing it](#how-to-opt-out-or-back-in) is what those commands are for.

After the first enabled run, the file looks like this:

```json
{
  "installationId": "7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f"
}
```

The first enabled run mints the `installationId` but does **not** write an `enableTelemetry` field — leaving it absent is what keeps telemetry on by default. Once you make an explicit choice with `prisma telemetry enable` / `disable`, the file also carries an explicit `enableTelemetry` value:

```json
{
  "enableTelemetry": true,
  "installationId": "7f1e1d6c-3b2a-4c5e-9f0d-1a2b3c4d5e6f"
}
```

Two fields matter to the CLI:

- **`enableTelemetry`** (`boolean`, optional) — your explicit choice. `true` enables telemetry; `false` disables it; **absent means "on" (the opt-out default)**. The CLI writes this field only when you make an explicit choice with `prisma telemetry enable` / `disable`; the default-on path never writes it.
- **`installationId`** (`string`) — a v4 random UUID, minted locally on the first command that sends an event (the first enabled send). The CLI never rotates it on its own.

Any other fields are tolerated and preserved across writes, so future Prisma Next versions can add new settings here without losing your existing data.

### Flipping your choice

To turn telemetry off (or back on), run `prisma telemetry disable` / `prisma telemetry enable`. The command writes the `enableTelemetry` value for you and the change takes effect on the next CLI invocation. `prisma telemetry status` reports what is in effect and why.

### Fully resetting

To start fresh — clear your installation ID and reset your preference — delete the file:

```bash
# Unix
rm ~/.config/prisma-next/config.json

# Windows (PowerShell)
Remove-Item "$env:APPDATA\prisma-next\config.json"
```

Deleting the file returns you to the default (telemetry on). The next enabled command will reprint the one-time first-run notice and mint a fresh `installationId`. If your intent is to stay opted out, don't delete the file — run `prisma telemetry disable`, or use an [environment-variable opt-out](#1-environment-variables-runtime-only).

## How to opt out (or back in)

Telemetry can be disabled several independent ways. Any one is sufficient.

### The `prisma telemetry` command

The command exists so you never have to touch the config file yourself:

```bash
prisma telemetry disable   # stores "enableTelemetry": false
prisma telemetry enable    # stores "enableTelemetry": true (mints an installation ID)
prisma telemetry status    # reports whether telemetry is on, why, the config path, and whether an ID is stored
```

`disable` and `enable` write the [stored preference](#2-the-stored-preference) for you — atomically, preserving every other field already in the file. `status` is read-only — it emits no event, mints no ID, and does not print your installation ID (only whether one exists). The `telemetry` command is itself exempt from telemetry, so running it never emits a usage event.

### 1. Environment variables (runtime-only)

Two env vars suppress telemetry without modifying any file on disk:

```bash
PRISMA_NEXT_DISABLE_TELEMETRY=1 prisma db migrate
DO_NOT_TRACK=1 prisma db migrate
```

- **`PRISMA_NEXT_DISABLE_TELEMETRY`** — disables telemetry when set to any truthy value. The values `""`, `"0"`, and `"false"` (case-insensitive) are treated as "not set" so an exported-but-blanked variable doesn't accidentally disable telemetry.
- **`DO_NOT_TRACK=1`** — the [community-standard opt-out signal](https://consoledonottrack.com). Disables telemetry when set to exactly `1`.

Either variable wins over the stored `enableTelemetry` value. The CLI **does not** rewrite your `config.json` in response to an env-var opt-out — your stored choice is preserved untouched, so unsetting the variable later restores whatever you had configured.

Export them in your shell profile if you want them to apply to every Prisma Next invocation.

### 2. The stored preference

`prisma telemetry disable` records the choice in your `config.json`:

```json
{
  "enableTelemetry": false
}
```

This disables telemetry on every invocation until `prisma telemetry enable` changes it back. Storing `false` does not mint an `installationId`, and if one was already minted on a prior enabled run it is left in place (deleting the file is the way to clear it).

To opt out on a machine where the CLI has never run — a fresh image, a provisioning script, a container build — set one of the [environment variables](#1-environment-variables-runtime-only) instead. No config file has to exist first: with telemetry disabled the CLI sends nothing and prints no first-run notice.

## Disclosure

Because telemetry is on by default, the CLI discloses it the first time it would actually send something. There is a single disclosure surface — the first-run notice — and it fires for every command, including `init`. There is no interactive consent prompt.

### The first-run notice

On the first command that resolves to *enabled* and has no `installationId` stored yet, the CLI prints a one-time notice to **stderr** (never stdout, so it can't corrupt piped output) and then mints the `installationId` and sends the event. The wording (verbatim, with the resolved absolute path to your config file substituted in) is:

> Prisma Next collects anonymous CLI usage data, enabled by default. What's collected and why: https://prisma-next.dev/docs/cli/telemetry. Opt out: run "prisma telemetry disable", set DO_NOT_TRACK=1 or PRISMA_NEXT_DISABLE_TELEMETRY=1, or set "enableTelemetry": false in &lt;your config.json path&gt;.

The notice is **idempotent via the `installationId`**: it prints only while no `installationId` is stored. Once the first enabled send mints the id, every later command sees the stored id and stays silent. Deleting `config.json` clears the id and makes the notice print once more on the next enabled command.

The notice does **not** fire when telemetry is disabled. If you've stored `enableTelemetry: false`, or set `DO_NOT_TRACK=1` / `PRISMA_NEXT_DISABLE_TELEMETRY`, or you're in CI, no notice is printed and nothing is sent — those paths have no `installationId` and never reach the first-run disclosure.

The `prisma telemetry` command never prints the notice and emits no event: it is exempt from telemetry so you can inspect or change your preference without sending anything.

## On by default

When `enableTelemetry` is absent — because you've never made an explicit choice, or the file is missing — telemetry is **enabled**. This is the opt-out default: absence of a stored choice means telemetry is on, and the first enabled command discloses that via the [first-run notice](#the-first-run-notice) before sending. The only things that turn telemetry off are an explicit `enableTelemetry: false`, an [environment-variable opt-out](#1-environment-variables-runtime-only), or a CI environment.

## Per-user, not per-project

Your telemetry preference lives in your user-level config file, not in your project's `prisma.config.ts`. There is intentionally no project-level telemetry toggle.

The reason is straightforward: one developer's telemetry choice should not be imposed on their teammates. A project-level setting committed to a repository would do exactly that — one person opting out (or in) would silently flip everyone who cloned the repo. The per-user file means each person on a team makes their own choice, and changing it never produces a diff in version control.

## CI environments

CI environments never emit telemetry and never see the first-run notice. The CLI uses the [`ci-info`](https://www.npmjs.com/package/ci-info) package to detect dozens of CI providers (GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins, Drone, Bitbucket Pipelines, Azure Pipelines, AWS CodeBuild, and more), so providers that don't set the standard `CI=true` marker still suppress telemetry correctly.

If you ever need to force the CLI to treat a CI environment as non-CI (e.g. to validate behaviour locally), set `CI=false` explicitly — `ci-info` short-circuits on that value.

## Agent detection

The `agent` field is populated by the [`@vercel/detect-agent`](https://www.npmjs.com/package/@vercel/detect-agent) package, which recognises well-known environment-variable markers set by AI coding tools. It reports lowercase agent identifiers such as `"claude"` (Claude Code), `"cursor"` / `"cursor-cli"`, `"codex"`, `"gemini"`, `"devin"`, `"github-copilot"`, `"replit"`, and others; it also honours the emerging `AI_AGENT` convention, so a tool that exports `AI_AGENT=<name>` is reported under that name.

When no marker is set, `agent` is `null`. The detection is **best-effort**: it cannot identify an agent that doesn't set a recognised env var. False negatives are expected and treated as "unknown" rather than "human". The full marker list lives in the [`@vercel/detect-agent` source](https://github.com/vercel/vercel/tree/main/packages/detect-agent); new agents are recognised by upgrading the dependency rather than by patching Prisma Next.

## How the data is used

Telemetry events feed a small set of product questions:

- **Is Prisma Next being used, and by how many people?** Monthly active users, computed from distinct `installationId`s.
- **Which databases do users target?** Distribution over `databaseTarget`, so target maintenance effort follows real usage.
- **Which extensions are adopted?** Counts over `extensions`, so first-party extension packs and community packs get visible adoption signal.
- **Which runtime and TypeScript versions are in use?** So deprecations follow actual user impact.
- **How much CLI usage flows through AI coding agents?** From the `agent` field, to inform docs and UX targeted at agent-driven workflows.

Aggregated metrics may be shared more broadly; raw event data is restricted to the product team.

## Where the implementation lives

Everything is open source. If you want to audit what gets sent, or how:

- **Client** (the part that decides whether to send and runs in your CLI): [`packages/1-framework/3-tooling/cli-telemetry/`](../packages/1-framework/3-tooling/cli-telemetry/)
- **Backend** (the service that receives events and stores them in Postgres): [`apps/telemetry-backend/`](../apps/telemetry-backend/)
- **Architectural rationale for the installation ID design:** [ADR 216 — CLI telemetry installation ID is a stored random UUID, not a system fingerprint](./architecture%20docs/adrs/ADR%20216%20-%20CLI%20telemetry%20installation%20ID%20is%20a%20stored%20random%20UUID%20not%20a%20system%20fingerprint.md)
- **Architectural rationale for the detached-subprocess design:** [ADR 217 — CLI telemetry runs in a detached subprocess spawned at command start](./architecture%20docs/adrs/ADR%20217%20-%20CLI%20telemetry%20runs%20in%20a%20detached%20subprocess%20spawned%20at%20command%20start.md)
- **Architectural rationale for the opt-out default:** [ADR 223 — CLI telemetry defaults to opt-out with a first-run notice](./architecture%20docs/adrs/ADR%20223%20-%20CLI%20telemetry%20defaults%20to%20opt-out%20with%20a%20first-run%20notice.md)
