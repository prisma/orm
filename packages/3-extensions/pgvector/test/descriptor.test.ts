/**
 * Structural verification for the pgvector extension descriptor.
 *
 * **Contract-space package layout.** The descriptor's
 * contract / migrations / head ref now flow through JSON-import
 * declarations from the package's emitted artefacts:
 *
 *   - `<package>/src/contract.json`
 *   - `<package>/migrations/<dirName>/{migration,ops}.json`
 *   - `<package>/migrations/refs/head.json`
 *
 * These assertions lock down the wiring: the descriptor exposes
 * structurally correct values; the parameterised `vector` native type
 * is registered under `storage.types`; and the head ref tracks the
 * latest migration's `to` hash.
 *
 * Hash-level values are sourced from the on-disk artefacts (via the
 * descriptor's contractSpace) rather than hand-pinned in the test, so
 * the assertions stay honest under re-emission. Mirrors the synthetic
 * extension's `test/descriptor.test.ts` reference model.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { describe, expect, it } from 'vitest';
import { VECTOR_CODEC_ID } from '../src/core/constants';
import {
  PGVECTOR_BASELINE_MIGRATION_NAME,
  PGVECTOR_INVARIANTS,
  PGVECTOR_NATIVE_TYPE,
  PGVECTOR_SPACE_ID,
} from '../src/core/contract-space-constants';
import pgvectorExtensionDescriptor from '../src/exports/control';

describe('pgvector extension descriptor (contract-space package layout)', () => {
  it('identifies as a SQL extension targeted at postgres', () => {
    expect(pgvectorExtensionDescriptor).toMatchObject({
      kind: 'extension',
      id: PGVECTOR_SPACE_ID,
      familyId: 'sql',
      targetId: 'postgres',
    });
  });

  it('exposes a contractSpace declaring the vector parameterised native type', () => {
    const space = pgvectorExtensionDescriptor.contractSpace;
    expect(space).toBeDefined();
    const namespaces = space!.contractJson.storage.namespaces as Record<
      string,
      { readonly entries: Record<string, Record<string, unknown>> }
    >;
    expect(Object.keys(namespaces[UNBOUND_NAMESPACE_ID]?.entries['table'] ?? {})).toEqual([]);
    expect(space!.contractJson.storage.types).toBeDefined();
    expect(space!.contractJson.storage.types?.[PGVECTOR_NATIVE_TYPE]).toMatchObject({
      codecId: VECTOR_CODEC_ID,
    });
  });

  it('publishes one baseline migration sourced from the on-disk emit pipeline', () => {
    const space = pgvectorExtensionDescriptor.contractSpace!;
    expect(space.migrations).toHaveLength(1);
    const baseline = space.migrations[0]!;
    expect(baseline.dirName).toBe(PGVECTOR_BASELINE_MIGRATION_NAME);
    expect(baseline.metadata.from).toBeNull();
    expect(baseline.metadata.to).toBe(space.contractJson.storage.storageHash);
  });

  it('baseline ops carry the installVectorExtension op with the stable invariantId', () => {
    const baseline = pgvectorExtensionDescriptor.contractSpace!.migrations[0]!;
    const opIds = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(opIds).toEqual([PGVECTOR_INVARIANTS.installVector]);
  });

  it('namespaces every baseline op invariantId under pgvector:*', () => {
    const baseline = pgvectorExtensionDescriptor.contractSpace!.migrations[0]!;
    const ids = baseline.ops.map((op) => op.invariantId).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^pgvector:/);
    }
  });

  it('the install-vector op carries the legacy CREATE EXTENSION DDL + postcondition', () => {
    const baseline = pgvectorExtensionDescriptor.contractSpace!.migrations[0]!;
    const installOp = baseline.ops.find(
      (op) => op.invariantId === PGVECTOR_INVARIANTS.installVector,
    ) as
      | {
          readonly precheck?: ReadonlyArray<{
            readonly sql: string;
            readonly params?: ReadonlyArray<unknown>;
          }>;
          readonly execute?: ReadonlyArray<{ readonly sql: string }>;
          readonly postcheck?: ReadonlyArray<{
            readonly sql: string;
            readonly params?: ReadonlyArray<unknown>;
          }>;
        }
      | undefined;
    expect(installOp).toBeDefined();
    expect(installOp!.execute?.[0]?.sql).toBe('CREATE EXTENSION IF NOT EXISTS vector');
    // TML-2889 routes pre/postcheck SELECTs through the typed query AST, which
    // parameterises the extname literal.
    expect(installOp!.postcheck?.[0]?.sql).toContain('"extname" = $1');
    expect(installOp!.postcheck?.[0]?.params).toEqual(['vector']);
    expect(installOp!.precheck?.[0]?.sql).toContain('"extname" = $1');
    expect(installOp!.precheck?.[0]?.params).toEqual(['vector']);
  });

  it("points the head ref at the latest migration's destination hash", () => {
    const space = pgvectorExtensionDescriptor.contractSpace!;
    expect(space.headRef.hash).toBe(space.migrations[0]!.metadata.to);
    expect([...space.headRef.invariants].sort()).toEqual(
      [...space.migrations[0]!.metadata.providedInvariants].sort(),
    );
  });

  it('self-consistency check passes — headRef.hash matches re-derived storage hash', () => {
    const space = pgvectorExtensionDescriptor.contractSpace!;
    expect(() =>
      assertDescriptorSelfConsistency({
        extensionId: PGVECTOR_SPACE_ID,
        target: space.contractJson.target,
        targetFamily: space.contractJson.targetFamily,
        storage: space.contractJson.storage as unknown as Record<string, unknown>,
        headRefHash: space.headRef.hash,
        ...sqlContractCanonicalizationHooks,
      }),
    ).not.toThrow();
  });
});
