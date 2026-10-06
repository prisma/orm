import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { createSqliteAdapter } from '@internal/adapter-sqlite/adapter';
import type { SqliteContract } from '@internal/adapter-sqlite/types';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import {
  type AnyJsonValueProjection,
  CodecJsonValueProjection,
  type CodecRef,
  ColumnRef,
  JsonDocumentProjection,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { isPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer } from '../../../../packages/2-sql/9-family/test/test-sql-contract-serializer';
import {
  planContract,
  representativePlans,
} from '../../../../packages/3-extensions/sql-orm-client/test/json-projection-plans';

const sqliteContract = new TestSqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            post: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
                price: { codecId: 'sqlite/bigint@1', nativeType: 'text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as SqliteContract;

const pgvectorCodecDescriptors = (pgvectorRuntime.types?.codecTypes?.codecDescriptors ?? []).filter(
  isPostgresCodecDescriptor,
);

describe('JSON projection variants', () => {
  // The ORM fixture contract has a `pg/vector@1` column, and the renderer now
  // asks a codec's descriptor how to project it. An adapter without the pack
  // that contributes the codec fails at lowering rather than rendering a bare
  // column — the same stack a pgvector application assembles.
  const postgresAdapter = createPostgresAdapter({
    codecDescriptors: pgvectorCodecDescriptors,
    dataTypes: pgvectorRuntime.dataTypes ?? [],
  });
  const sqliteAdapter = createSqliteAdapter();

  /**
   * The baseline: the SQL these plans rendered before the ORM chose variants.
   * Recorded from the planner as it stood, and asserted unchanged afterwards.
   *
   * A variant choice that reached the rendered SQL — a codec entry the planner
   * put where a document belongs, an entry that stopped being emitted, a plan
   * shape that moved — changes one of these strings and fails here. What it
   * cannot catch on its own is the planner not choosing variants at all, which
   * is what the emission assertions below are for; the two together say
   * "the ORM now states the semantics, and the SQL did not move".
   */
  describe('renders the SQL it rendered before variants were chosen', () => {
    for (const [label, ast] of representativePlans()) {
      it(label, () => {
        expect(postgresAdapter.lower(ast, { contract: planContract }).sql).toMatchSnapshot();
      });
    }
  });

  /**
   * The summary check a reviewer runs to believe the cut, alongside
   * `include-codecs.test.ts`: over one expression, does the renderer act on
   * the variant? Each target answers for itself, because "acts on it" means
   * something different per target — the assertion is what that target's
   * semantics require, not a uniform "all three differ".
   */
  describe('the renderers act on the variant', () => {
    function selectProjecting(variant: AnyJsonValueProjection, table: string): SelectAst {
      return SelectAst.from(TableSource.named(table)).withProjection([
        ProjectionItem.of(
          'json',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', variant)]),
        ),
      ]);
    }

    describe('PostgreSQL', () => {
      const value = ColumnRef.of('posts', 'views');
      const nonIdentity: CodecRef = { codecId: 'pg/numeric@1' };
      const identity: CodecRef = { codecId: 'pg/int4@1' };

      function render(variant: AnyJsonValueProjection): string {
        return postgresAdapter.lower(selectProjecting(variant, 'posts'), {
          contract: planContract,
        }).sql;
      }

      it('a codec whose canonical JSON is not its stored form renders differently from native', () => {
        expect(render(new CodecJsonValueProjection(value, nonIdentity))).not.toBe(
          render(new NativeJsonValueProjection(value)),
        );
      });

      it('the difference is the codec descriptor projection, not incidental', () => {
        expect(render(new CodecJsonValueProjection(value, nonIdentity))).toContain(
          'CAST("posts"."views" AS text)',
        );
      });

      it('a codec whose canonical JSON is its stored form renders like native', () => {
        expect(render(new CodecJsonValueProjection(value, identity))).toBe(
          render(new NativeJsonValueProjection(value)),
        );
      });

      // Not an oversight that document matches native here: PostgreSQL carries
      // a JSON value's type with it, so nesting a document needs no help. The
      // assertion is per-target for exactly this reason.
      it('a document renders like native, PostgreSQL preserving JSON type', () => {
        expect(render(new JsonDocumentProjection(value))).toBe(
          render(new NativeJsonValueProjection(value)),
        );
      });

      it('an unregistered codec fails at lowering rather than rendering a bare column', () => {
        expect(() =>
          render(new CodecJsonValueProjection(value, { codecId: 'nowhere/codec@1' })),
        ).toThrow(/nowhere\/codec@1/);
      });
    });

    describe('SQLite', () => {
      const value = ColumnRef.of('post', 'price');
      const nonIdentity: CodecRef = { codecId: 'sqlite/bigint@1' };
      const identity: CodecRef = { codecId: 'sqlite/text@1' };

      function render(variant: AnyJsonValueProjection): string {
        return sqliteAdapter.lower(selectProjecting(variant, 'post'), {
          contract: sqliteContract,
        }).sql;
      }

      it('a codec whose canonical JSON is not its stored form renders differently from native', () => {
        expect(render(new CodecJsonValueProjection(value, nonIdentity))).not.toBe(
          render(new NativeJsonValueProjection(value)),
        );
      });

      it('the difference is the codec descriptor projection, not incidental', () => {
        expect(render(new CodecJsonValueProjection(value, nonIdentity))).toContain(
          'CAST("post"."price" AS TEXT)',
        );
      });

      it('a codec whose canonical JSON is its stored form renders like native', () => {
        expect(render(new CodecJsonValueProjection(value, identity))).toBe(
          render(new NativeJsonValueProjection(value)),
        );
      });

      // Here is where the two targets genuinely differ, which is why the
      // assertion is per-target rather than a shared "all three differ".
      // PostgreSQL carries a JSON value's type with it, so a document nested
      // into an enclosing document needs no help and legitimately renders like
      // native. SQLite keeps that as a subtype which a derived table drops, so
      // there is no such coincidence: a document must be retagged, and a
      // document rendering like native would mean the retag went missing.
      it('a document renders differently from native, SQLite dropping the JSON subtype', () => {
        const document = render(new JsonDocumentProjection(value));

        expect(document).not.toBe(render(new NativeJsonValueProjection(value)));
        expect(document).toContain('json("post"."price")');
      });

      it('an unregistered codec fails at lowering rather than rendering a bare column', () => {
        expect(() =>
          render(new CodecJsonValueProjection(value, { codecId: 'nowhere/codec@1' })),
        ).toThrow(/nowhere\/codec@1/);
      });
    });
  });
});
