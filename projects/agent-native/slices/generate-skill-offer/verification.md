# Verification record — generate-skill-offer

Evidence from S2-D3 live runs (2026-07-03; CLI built from `744539ec0`; scratch project cloned
from the `example-project` fixture with `@prisma/client`/`@prisma/config` symlinked; curated
`env -i` environment; per-run isolated `XDG_CONFIG_HOME` with `prisma-nodejs/` pre-created
and `commands.json` seeded 30 days back per the two suppression traps).

- **First interactive run (pty via `script -qec`):** offer shown ("Install Prisma's agent
  skills so AI coding tools work better with this project? (y/N) — This prompt closes in 30s
  and can be suppressed with --no-hints"); answer `n` → exit 0, generate normal,
  `skills-offer.json` = `{"offeredAt":"2026-07-03T21:19:37.040Z","outcome":"declined"}`.
- **Second run, same config dir:** no prompt of any kind; exit 0.
- **Accept path (fresh dir):** answer `y` → S1 runner streams installs; 24 `SKILL.md` (8
  skills × `.agents`/`.claude`/`.windsurf`), `skills-lock.json` present; generate succeeds;
  acknowledgement `outcome: "accepted"`.
- **Non-TTY (plain pipes):** no prompt; generate normal; **no acknowledgement written** — a
  gated-out run leaves the offer available for a future interactive session.
- **Mutual exclusion:** in both prompted runs the skills offer was the only prompt; no NPS
  question appeared in any run (no active NPS timeframe remotely; the mechanism itself is
  pinned by S2-D2 unit tests).
- Container/CI gates verified against their real implementations for this sandbox (pid 1 is
  systemd; no `/.dockerenv` etc.) — nothing was faked.

Cosmetic observation (expected): on accept, the installer output streams before the
"Generated Prisma Client" line because `Generate.parse` returns the summary for the caller
to print after the offer resolves.
