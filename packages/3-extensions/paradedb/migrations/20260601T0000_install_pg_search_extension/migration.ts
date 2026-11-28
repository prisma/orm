#!/usr/bin/env -S node
/**
 * paradedb baseline migration — install the `pg_search` Postgres
 * extension and register the invariantId for the BM25 full-text search
 * surface downstream consumers depend on.
 *
 * The contract IR (see `<package>/src/contract.json`) declares no tables or
 * native types — paradedb ships none of its own. The single op here
 * carries the `CREATE EXTENSION IF NOT EXISTS pg_search` DDL plus pre-
 * and postconditions; downstream BM25 indexes in user contracts rely on
 * this op having applied first.
 *
 * The op carries the stable `paradedb:install-pg-search-v1` invariantId
 * — once published it is immutable.
 *
 * Authoring loop: this file is hand-edited (Path B — see
 * `docs/architecture docs/adrs/ADR 212 - Contract spaces.md`,
 * contract-space package layout section). The CLI's `migration plan`
 * command refuses to scaffold this directory because paradedb's
 * contract has no tables / models for the planner to diff. The migration
 * directory + Migration subclass + a seed `migration.json` were authored
 * by hand; `pnpm tsx migrations/<dirName>/migration.ts` then
 * re-emits `ops.json` + `migration.json` deterministically.
 */
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';
import { PARADEDB_INVARIANTS } from '../../src/core/constants';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'e81e803de91cbef4b610501081e694374c04b40fb43c360d62c72e81279e7f4a',
    };
  }

  override get operations() {
    return [
      this.installExtension({
        id: 'paradedb.install-pg-search-extension',
        extensionName: 'pg_search',
        invariantId: PARADEDB_INVARIANTS.installPgSearch,
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
