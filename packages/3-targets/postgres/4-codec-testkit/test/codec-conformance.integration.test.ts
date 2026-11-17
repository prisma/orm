/**
 * Runs the codec JSON-projection conformance harness against a live PostgreSQL
 * for every built-in codec descriptor.
 *
 * An unmarked case must conform: `fromWire` reads the projected value to the
 * application value it reads the ordinary row to, which is the value the case
 * wrote. A marked case must still fail, and fail with the kind it records, so
 * neither the marker nor its recorded kind can rot as projections change. See
 * `codec-conformance/cases.ts`.
 */

import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { runPostgresCodecProjection } from '../src/index';
import { postgresConformanceCases } from './codec-conformance/cases';
import { connectRuntimeDriver } from './runtime-connection';

describe('PostgreSQL codec JSON-projection conformance', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    runtime = await connectRuntimeDriver(database.connectionString);
    connection = runtime.connection;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
    runtime = undefined;
    connection = undefined;
    await database?.close();
    database = undefined;
  }, timeouts.spinUpPpgDev);

  it('registers a representative value for every built-in descriptor', () => {
    const covered = new Set(postgresConformanceCases.map((entry) => entry.codecId));
    const uncovered = [...postgresCodecDescriptorRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !covered.has(codecId));

    expect(uncovered).toEqual([]);
  });

  // Null is a dimension every column has, and it is what let the interval
  // projection report an absent value as a zero one. Requiring a case per
  // descriptor makes the dimension self-enforcing: a new codec cannot register
  // without one.
  it('registers a NULL case for every built-in descriptor', () => {
    const covered = new Set(
      postgresConformanceCases
        .filter((entry) => entry.nullValue === true)
        .map((entry) => entry.codecId),
    );
    const uncovered = [...postgresCodecDescriptorRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !covered.has(codecId));

    expect(uncovered).toEqual([]);
  });

  for (const conformanceCase of postgresConformanceCases) {
    const expectation =
      conformanceCase.notYetCanonical === undefined
        ? 'reads the same through its projection as through a row'
        : 'still fails the way its case records';

    it(`${conformanceCase.codecId} (${conformanceCase.label}) ${expectation}`, {
      timeout: timeouts.spinUpPpgDev,
    }, async () => {
      const outcome = await runPostgresCodecProjection(connection!, conformanceCase);

      if (conformanceCase.notYetCanonical === undefined) {
        expect(outcome.failure).toBeUndefined();
      } else {
        expect(outcome.failure?.kind).toBe(conformanceCase.notYetCanonical.kind);
      }
    });
  }
});
