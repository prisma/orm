import { generateContractDts } from '@internal/emitter';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { blogContract } from './fixtures/blog-contract';

const testHashes = { storageHash: 'blog-test', profileHash: 'blog-profile' };

const mongoCodecImports: TypesImportSpec[] = [
  {
    package: '@internal/target-mongo/codec-types',
    named: 'CodecTypes',
    alias: 'MongoCodecTypes',
  },
];

describe('Mongo emitter hook end-to-end (blog fixture)', () => {
  it('validates the blog contract', () => {
    expect(() => mongoEmission.validateTypes(blogContract, {})).not.toThrow();
    expect(() => mongoEmission.validateStructure(blogContract)).not.toThrow();
  });

  it('generates complete contract.d.ts from blog contract', () => {
    const types = generateContractDts(blogContract, mongoEmission, mongoCodecImports, testHashes);

    expect(types).toContain(
      'export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>',
    );
    expect(types).toContain(
      'export type TypeMaps = MongoTypeMaps<CodecTypes, FieldOutputTypes, FieldInputTypes>',
    );
    expect(types).toContain('export type CodecTypes = MongoCodecTypes');

    expect(types).toContain(
      'readonly users: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "User" }',
    );
    expect(types).toContain(
      'readonly posts: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
    );

    expect(types).toContain('readonly User:');
    expect(types).toContain('readonly Post:');
    expect(types).toContain('readonly Comment:');

    expect(types).toContain(
      'readonly _id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/objectId@1" } }',
    );
    expect(types).toContain(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
    );
    expect(types).toContain(
      'readonly bio: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
    );

    expect(types).toContain(
      'readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
    );
    expect(types).toContain('readonly cardinality: "1:N"');
    expect(types).toContain('readonly localFields: readonly ["_id"]');
    expect(types).toContain('readonly targetFields: readonly ["authorId"]');

    expect(types).toContain('readonly owner: "Post"');

    expect(types).toContain('readonly collection: "users"');
    expect(types).toContain('readonly collection: "posts"');

    expect(types).toContain(
      'readonly relations: { readonly comments: { readonly field: "comments" } }',
    );

    expect(types).not.toContain('strategy');
  });

  it('generates storage section with namespaces', () => {
    const types = generateContractDts(blogContract, mongoEmission, [], testHashes);

    expect(types).toContain('readonly namespaces:');
    expect(types).toContain('readonly collection:');
    expect(types).toContain('readonly users: MongoCollection');
    expect(types).toContain('readonly posts: MongoCollection');
  });

  it('generates Comment model with owner and empty storage', () => {
    const types = generateContractDts(blogContract, mongoEmission, [], testHashes);

    expect(types).toContain(
      'readonly text: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
    );
    expect(types).toContain(
      'readonly createdAt: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/date@1" } }',
    );
    expect(types).toContain('readonly owner: "Post"');
  });
});
