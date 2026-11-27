import { describe, expect, it } from 'vitest';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from './collection-fixtures';

const perRelationContract = withoutCapabilityKeys(baseContract, [
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
]);

function refusal(method: string) {
  return expect.objectContaining({
    code: 'ORM.CAPABILITY_MISSING',
    message: `\`prepared.${method}()\` with includes is unavailable: your contract declares no dependency on \`sql.outerReferencesInDerivedTables\` and \`sql.jsonAggWithoutTruncation\`. Without them, includes load with one query per relation, and a prepared read is one statement. To enable it, add \`sql.outerReferencesInDerivedTables\` and \`sql.jsonAggWithoutTruncation\` to your contract's required capabilities.`,
    meta: {
      capabilities: ['sql.outerReferencesInDerivedTables', 'sql.jsonAggWithoutTruncation'],
      method: `prepared.${method}`,
    },
  });
}

describe('a prepared read with includes when includes load with one query per relation', () => {
  it.each(['all', 'first', 'firstOrThrow'] as const)('is refused by prepared.%s()', (method) => {
    const { collection } = createCollectionFor('User', perRelationContract);
    const prepared = collection.include('posts').prepared;

    expect(() => prepared[method]()).toThrow(refusal(method));
  });

  it('names the one capability the contract lacks', () => {
    const contract = withoutCapabilityKeys(baseContract, ['jsonAggWithoutTruncation']);
    const { collection } = createCollectionFor('User', contract);

    expect(() => collection.include('posts').prepared.all()).toThrow(
      expect.objectContaining({
        message:
          "`prepared.all()` with includes is unavailable: your contract declares no dependency on `sql.jsonAggWithoutTruncation`. Without it, includes load with one query per relation, and a prepared read is one statement. To enable it, add `sql.jsonAggWithoutTruncation` to your contract's required capabilities.",
        meta: { capabilities: ['sql.jsonAggWithoutTruncation'], method: 'prepared.all' },
      }),
    );
  });

  it('is not refused without includes', () => {
    const { collection } = createCollectionFor('User', perRelationContract);

    expect(() => collection.prepared.all()).not.toThrow();
  });

  it('is not refused when includes load in one query', () => {
    const { collection } = createCollectionFor('User');

    expect(() => collection.include('posts').prepared.all()).not.toThrow();
  });
});
