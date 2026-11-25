# Files a Prisma 7 project stored under `8.0.0-rc.18`

`contract.json` and `contract.d.ts` stand for what `8.0.0-rc.18` stored for the `supported/schema.prisma` Prisma 7 source: every list column with non-null elements and a waived element check (`noCheck`), `schemaVersion: "1"` and no `formatVersion`, and the storage and profile hashes computed by the rc.18 rules. `cli-journeys/prisma7-source.remove-nocheck-upgrade.e2e.test.ts` starts from them and runs each upgrade script to this release.

They were produced by emitting that source on a branch where the hashes still followed the rc.18 rules, before the change to the hash inputs, with a temporary copy of the journey that wrote these two files. The rc.18 `remove-nocheck` upgrade script checks the stored storage hash against the content by the rc.18 rules on every run of the journey, so a hand edit that breaks the hash fails the journey. Fields other than the list columns and the hashes are what that branch emitted, not byte for byte what rc.18 wrote.

These files are a released state. Do not regenerate them from today's emit: no code in this repository computes the rc.18 hash any more. If the journey breaks because today's emit for that source changed, change the journey, not these files.
