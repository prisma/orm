import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import { withMarkerReadErrorHandling } from '@internal/errors/execution';
import type {
  MongoControlAdapter,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type { ControlDriverInstance } from '@internal/framework-components/control';
import { ledgerOriginFromStored } from '@internal/migration-tools/ledger-origin';
import type { MongoAdapter, MongoDriver } from '@internal/mongo-lowering';
import type { AnyMongoDdlCommand } from '@internal/mongo-query-ast/control';
import {
  type AnyMongoCommand,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  type MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { expr, fn } from '@internal/mongo-query-builder';
import { collection } from '@internal/mongo-query-builder/contract-free';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type { MongoValue } from '@internal/mongo-value';
import { blindCast } from '@internal/utils/casts';
import type { Document } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { describeReceivedValue, mongoAdapterError } from './errors';
import { MongoInspectionExecutor } from './inspection-executor';
import { introspectSchema } from './introspect-schema';
import {
  MONGO_LEDGER_COLLECTION,
  MONGO_MARKER_COLLECTION,
  parseMongoMarkerDocSafely,
} from './marker-ledger';
import { MARKER_LEDGER_COLLECTION, type MarkerLedgerDocShape } from './marker-ledger-collection';
import { extractDb, isMongoControlDriver, requireMongoControlDriver } from './mongo-control-driver';

/**
 * Mongo control adapter for control-plane operations like introspection
 * and marker-ledger CAS. Implements the family-level `MongoControlAdapter`
 * SPI. Every marker/ledger operation builds a canonical command inline via
 * the contract-free fluent builder and dispatches it through the family
 * adapter's lowering path (`createMongoAdapter().lower(plan, {})`) onto the
 * Mongo wire transport (`driver.execute(wireCommand)`) — the same route SQL
 * marker/ledger ops take through `adapter.lower()` → `driver.query()`.
 */
export class MongoControlAdapterImpl implements MongoControlAdapter<'mongo'> {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  readonly #adapter: MongoAdapter = createMongoAdapter();
  readonly #markerLedgerCollection = collection<MarkerLedgerDocShape>(MARKER_LEDGER_COLLECTION);

  async #execute(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    command: AnyMongoCommand,
  ): Promise<Document[]> {
    const plan: MongoQueryPlan = {
      collection: MARKER_LEDGER_COLLECTION,
      command,
      meta: { target: 'mongo', targetFamily: 'mongo', storageHash: '', lane: 'control' },
    };
    const wireCommand = await this.#adapter.lower(plan, {});
    if (!isMongoControlDriver(driver)) {
      throw mongoAdapterError(
        'CONFIG.VALIDATION_FAILED',
        'Mongo control adapter requires a Mongo control driver with an execute() transport. ' +
          'Provide a MongoControlDriver from `@internal/driver-mongo/control`.',
        { meta: { received: describeReceivedValue(driver) } },
      );
    }
    const rows: Document[] = [];
    for await (const row of driver.execute<Document>(wireCommand)) {
      rows.push(row);
    }
    return rows;
  }

  async executeDdl(driver: MongoDriver, command: AnyMongoDdlCommand): Promise<void> {
    const wire = await this.#adapter.lower({ command }, {});
    await driver.run(wire);
  }

  /**
   * Server-side invariant-merge aggregation expression:
   * `$sortArray({ input: $setUnion([$ifNull('$invariants', []), incoming]), sortBy: 1 })`.
   *
   * Built through the typed agg-expr layer — `fn.setUnion` plus the generic
   * `MongoAggOperator` for `$ifNull` / `$sortArray` (neither has a named `fn`
   * helper). Returns a `MongoAggOperator` that is passed directly to
   * `f.stage.set({ invariants: ... })` in the update pipeline.
   */
  #invariantMergeExpr(incoming: readonly string[]): MongoAggOperator {
    const existingOrEmpty = MongoAggOperator.of('$ifNull', [
      MongoAggFieldRef.of('invariants'),
      MongoAggLiteral.of([]),
    ]);
    const merged = fn.setUnion(
      { _field: { codecId: 'mongo/array@1', nullable: false }, node: existingOrEmpty },
      {
        _field: { codecId: 'mongo/array@1', nullable: false },
        node: MongoAggLiteral.of([...incoming]),
      },
    );
    return MongoAggOperator.of('$sortArray', { input: merged.node, sortBy: MongoAggLiteral.of(1) });
  }

  async readMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const markerContext = { space, markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        this.#execute(
          driver,
          this.#markerLedgerCollection
            .aggregate()
            .match((f) => f._id.eq(space))
            .match((f) => f.space.eq(space))
            .limit(1)
            .build(),
        ),
      markerContext,
    );
    const doc = docs[0];
    if (!doc) return null;
    return parseMongoMarkerDocSafely(doc, space);
  }

  async readAllMarkers(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const markerContext = { space: 'app', markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        this.#execute(
          driver,
          this.#markerLedgerCollection
            .aggregate()
            .match((f) => f._id.type('string'))
            .match((f) => f.space.type('string'))
            .match((f) => expr(fn.eq(f._id, f.space)))
            .build(),
        ),
      markerContext,
    );
    const out = new Map<string, ContractMarkerRecord>();
    for (const doc of docs) {
      const space = doc['space'];
      /* v8 ignore next -- @preserve type-narrowing guard: the $match stage above filters on `space: { $type: 'string' }`, so this branch is unreachable at runtime. The check exists so the `out.set(space, ...)` call below can accept `string`. */
      if (typeof space !== 'string') continue;
      out.set(space, parseMongoMarkerDocSafely(doc, space));
    }
    return out;
  }

  async initMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    const document: Record<string, MongoValue> = {
      _id: space,
      space,
      storageHash: destination.storageHash,
      profileHash: destination.profileHash,
      contractJson: null,
      canonicalVersion: null,
      updatedAt: new Date(),
      appTag: null,
      meta: {},
      invariants: [...(destination.invariants ?? [])],
    };
    await this.#execute(driver, this.#markerLedgerCollection.insertOne(document));
  }

  async updateMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean> {
    const { invariants } = destination;
    const docs = await this.#execute(
      driver,
      this.#markerLedgerCollection
        .match((f) => f._id.eq(space))
        .match((f) => f.space.eq(space))
        .match((f) => f.storageHash.eq(expectedFrom))
        .findOneAndUpdate(
          (f) => [
            f.stage.set(
              invariants === undefined
                ? {
                    storageHash: MongoAggLiteral.of(destination.storageHash),
                    profileHash: MongoAggLiteral.of(destination.profileHash),
                    updatedAt: MongoAggLiteral.of(new Date()),
                  }
                : {
                    storageHash: MongoAggLiteral.of(destination.storageHash),
                    profileHash: MongoAggLiteral.of(destination.profileHash),
                    updatedAt: MongoAggLiteral.of(new Date()),
                    invariants: this.#invariantMergeExpr(invariants),
                  },
            ),
          ],
          { upsert: false },
        ),
    );
    return docs.length > 0;
  }

  async writeLedgerEntry(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void> {
    const document: Record<string, MongoValue> = {
      type: 'ledger',
      space,
      edgeId: entry.edgeId,
      from: entry.from,
      to: entry.to,
      migrationName: entry.migrationName,
      migrationHash: entry.migrationHash,
      operations: blindCast<ReadonlyArray<MongoValue>, 'ledger operation docs are BSON values'>(
        entry.operations,
      ),
      appliedAt: new Date(),
    };
    await this.#execute(driver, this.#markerLedgerCollection.insertOne(document));
  }

  async readLedger(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: MONGO_LEDGER_COLLECTION };
    const chain = this.#markerLedgerCollection.aggregate().match((f) => f.type.eq('ledger'));
    const command =
      space === undefined
        ? chain.sort({ _id: 1 }).build()
        : chain
            .match((f) => f.space.eq(space))
            .sort({ _id: 1 })
            .build();
    const docs = await withMarkerReadErrorHandling(
      () => this.#execute(driver, command),
      ledgerContext,
    );

    const entries: LedgerEntryRecord[] = [];
    for (const doc of docs) {
      const migrationName = doc['migrationName'];
      const migrationHash = doc['migrationHash'];
      const from = doc['from'];
      const to = doc['to'];
      const docSpace = doc['space'];
      if (typeof migrationName !== 'string' || typeof migrationHash !== 'string') {
        continue;
      }
      if (typeof from !== 'string' || typeof to !== 'string') {
        continue;
      }
      if (typeof docSpace !== 'string') {
        continue;
      }
      const appliedAt = doc['appliedAt'];
      const appliedAtDate =
        appliedAt instanceof Date
          ? appliedAt
          : appliedAt !== undefined
            ? new Date(String(appliedAt))
            : new Date();
      const operations = doc['operations'];
      const opList = Array.isArray(operations) ? operations : [];
      entries.push({
        space: docSpace,
        migrationName,
        migrationHash,
        from: ledgerOriginFromStored(from),
        to,
        appliedAt: appliedAtDate,
        operationCount: opList.length,
      });
    }
    return entries;
  }

  async introspectSchema(driver: ControlDriverInstance<'mongo', 'mongo'>): Promise<MongoSchemaIR> {
    return introspectSchema(extractDb(driver));
  }

  createRunnerDependencies(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
  ): MongoRunnerDependencies {
    const controlDriver = requireMongoControlDriver(driver);
    return {
      inspectionExecutor: new MongoInspectionExecutor(controlDriver.db),
      adapter: this.#adapter,
      driver: controlDriver,
      executeDdl: (command) => this.executeDdl(controlDriver, command),
      markerOps: {
        readMarker: (space) => this.readMarker(controlDriver, space),
        initMarker: (space, destination) => this.initMarker(controlDriver, space, destination),
        updateMarker: (space, expectedFrom, destination) =>
          this.updateMarker(controlDriver, space, expectedFrom, destination),
        writeLedgerEntry: (space, entry) => this.writeLedgerEntry(controlDriver, space, entry),
      },
      introspectSchema: () => this.introspectSchema(controlDriver),
    };
  }
}
