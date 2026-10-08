import { describe, expect, it } from 'vitest';
import { errorStatementOriginUnknown } from '../src/utils/cli-errors';

const HASH = 'sha256:abc';
const DIR = 'migrations/snapshots/sha256:abc';

function adviceOf(error: ReturnType<typeof errorStatementOriginUnknown>): readonly string[] {
  const envelope = error.toEnvelope();
  return [envelope.fix ?? '', ...(envelope.nextActions ?? []).map((action) => action.label)];
}

describe('errorStatementOriginUnknown', () => {
  const variants = {
    'no marker': errorStatementOriginUnknown({
      hash: null,
      snapshotDirectory: DIR,
      unreadable: undefined,
    }),
    'unreadable snapshot': errorStatementOriginUnknown({
      hash: HASH,
      snapshotDirectory: DIR,
      unreadable: 'Failed to parse',
    }),
    'missing snapshot': errorStatementOriginUnknown({
      hash: HASH,
      snapshotDirectory: DIR,
      unreadable: undefined,
    }),
  };

  it.each(Object.entries(variants))(
    'advises no plan without statements unless it says the plan drops data (%s)',
    (_, error) => {
      for (const advice of adviceOf(error)) {
        if (/without (the )?statements|leave out the statements/i.test(advice)) {
          expect(advice).toContain(
            'drops the storage of each renamed model or field with its data',
          );
        }
      }
    },
  );

  it('never offers migration plan --from as a route for db update', () => {
    for (const error of Object.values(variants)) {
      expect(error.toEnvelope().nextActions ?? []).not.toContainEqual(
        expect.objectContaining({ command: expect.stringContaining('migration plan') }),
      );
    }
  });

  it('says why the snapshot is missing and gives the route that stores it first', () => {
    const envelope = variants['missing snapshot'].toEnvelope();
    expect(envelope.why).toContain(
      'stores the snapshot of the contract it applies only when it advances a ref',
    );
    expect(envelope.fix).toBe(
      [
        'Store the snapshot of the contract the database is at, then run the rename:',
        '1. Put the contract source back to the version the database is at, and run `{bin} contract emit`.',
        '2. Run `{bin} db update --advance-ref <name> --dry-run`, with the same `--db` as this command if it has one, and check that it plans no operations. Then run it again without `--dry-run`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.',
        '3. Put the new contract source back, run `{bin} contract emit`, and run this command again with `--advance-ref <name>`.',
        'Adding --advance-ref to this command alone does not help: it would store the new contract, not the one the database is at. `migration plan --from` does not apply to `db update`.',
      ].join('\n'),
    );
  });
});
