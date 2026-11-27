import type { PlanMeta } from '@internal/contract/types';
import {
  AggregateWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  InsertOneWireCommand,
  UpdateOneWireCommand,
} from '@internal/mongo-wire';
import { describe, expect, it } from 'vitest';
import { computeMongoContentHash } from '../src/content-hash';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';

function makeMeta(overrides?: Partial<PlanMeta>): PlanMeta {
  return {
    target: 'mongodb',
    storageHash: 'test',
    lane: 'mongo',
    ...overrides,
  };
}

function makeExec(overrides?: {
  command?: MongoExecutionPlan['command'];
  meta?: Partial<PlanMeta>;
}): MongoExecutionPlan {
  return {
    command: overrides?.command ?? new InsertOneWireCommand('users', { _id: 'a' }),
    meta: makeMeta(overrides?.meta),
  };
}

describe('computeMongoContentHash', () => {
  describe('stability', () => {
    it('returns the same hash for plans with equivalent commands', async () => {
      const a = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', name: 'Alice' }),
      });
      const b = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', name: 'Alice' }),
      });
      expect(await computeMongoContentHash(a)).toBe(await computeMongoContentHash(b));
    });

    it('returns the same hash across repeated invocations', async () => {
      const exec = makeExec({
        command: new UpdateOneWireCommand('users', { _id: 'a' }, { $set: { active: true } }),
      });
      const first = await computeMongoContentHash(exec);
      const second = await computeMongoContentHash(exec);
      const third = await computeMongoContentHash(exec);
      expect(first).toBe(second);
      expect(second).toBe(third);
    });

    it('is insensitive to object key insertion order in the document', async () => {
      const a = makeExec({
        command: new InsertOneWireCommand('users', { name: 'Alice', age: 30 }),
      });
      const b = makeExec({
        command: new InsertOneWireCommand('users', { age: 30, name: 'Alice' }),
      });
      expect(await computeMongoContentHash(a)).toBe(await computeMongoContentHash(b));
    });

    it('is insensitive to nested object key order in the filter', async () => {
      const a = makeExec({
        command: new UpdateOneWireCommand(
          'users',
          { profile: { city: 'Berlin', country: 'DE' } },
          { $set: { active: true } },
        ),
      });
      const b = makeExec({
        command: new UpdateOneWireCommand(
          'users',
          { profile: { country: 'DE', city: 'Berlin' } },
          { $set: { active: true } },
        ),
      });
      expect(await computeMongoContentHash(a)).toBe(await computeMongoContentHash(b));
    });
  });

  describe('discrimination', () => {
    it('discriminates on differing storageHash with the same command', async () => {
      const command = new InsertOneWireCommand('users', { _id: 'a' });
      const a = makeExec({ command, meta: { storageHash: 'v1' } });
      const b = makeExec({ command, meta: { storageHash: 'v2' } });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on differing collection names', async () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { _id: 'a' }) });
      const b = makeExec({ command: new InsertOneWireCommand('orders', { _id: 'a' }) });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on differing command kinds (insertOne vs updateOne)', async () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { _id: 'a' }) });
      const b = makeExec({
        command: new UpdateOneWireCommand('users', { _id: 'a' }, { $set: { _id: 'a' } }),
      });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on differing document values', async () => {
      const a = makeExec({ command: new InsertOneWireCommand('users', { name: 'Alice' }) });
      const b = makeExec({ command: new InsertOneWireCommand('users', { name: 'Bob' }) });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on differing filter values for the same kind', async () => {
      const a = makeExec({
        command: new DeleteOneWireCommand('users', { _id: 'a' }),
      });
      const b = makeExec({
        command: new DeleteOneWireCommand('users', { _id: 'b' }),
      });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on differing aggregate pipelines', async () => {
      const a = makeExec({
        command: new AggregateWireCommand('users', [{ $match: { active: true } }]),
      });
      const b = makeExec({
        command: new AggregateWireCommand('users', [{ $match: { active: false } }]),
      });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });

    it('discriminates on pipeline stage order (arrays are order-significant)', async () => {
      const a = makeExec({
        command: new AggregateWireCommand('users', [
          { $match: { active: true } },
          { $sort: { name: 1 } },
        ]),
      });
      const b = makeExec({
        command: new AggregateWireCommand('users', [
          { $sort: { name: 1 } },
          { $match: { active: true } },
        ]),
      });
      expect(await computeMongoContentHash(a)).not.toBe(await computeMongoContentHash(b));
    });
  });

  describe('aggregate and bypassDocumentValidation', () => {
    const pipeline = [{ $match: { active: true } }];

    it('keeps the fields and hash of an aggregate without the option', async () => {
      const command = new AggregateWireCommand('users', pipeline);
      expect({
        fields: Object.keys({ ...command }).sort(),
        hash: await computeMongoContentHash(makeExec({ command })),
      }).toEqual({
        fields: ['collection', 'kind', 'pipeline'],
        hash: 'sha512:502ac3ab70d837033870dc00c4ad3ac88e5f1351cbd76137faf89e46932f0a6105ffdef4f7b33a59b52eec0afdd43f17de2ef845d3a2875ebfd77e3d3aaaf74c',
      });
    });

    it('stores the option only when it is true, and hashes it', async () => {
      const off = new AggregateWireCommand('users', pipeline, { bypassDocumentValidation: false });
      const on = new AggregateWireCommand('users', pipeline, { bypassDocumentValidation: true });
      expect({
        off: Object.keys({ ...off }).sort(),
        on: on.bypassDocumentValidation,
        sameHash:
          (await computeMongoContentHash(makeExec({ command: on }))) ===
          (await computeMongoContentHash(makeExec({ command: off }))),
      }).toEqual({ off: ['collection', 'kind', 'pipeline'], on: true, sameHash: false });
    });
  });

  describe('deleteMany and collation', () => {
    const filter = { kind: 'sample' };

    it('keeps the fields and hash of a delete without a collation', async () => {
      const command = new DeleteManyWireCommand('events', filter);
      expect({
        fields: Object.keys({ ...command }).sort(),
        hash: await computeMongoContentHash(makeExec({ command })),
      }).toEqual({
        fields: ['collection', 'filter', 'kind'],
        hash: 'sha512:ae26a094087f58cd66ffad858da225596a57c06cf9d900e4f750204a0c2912b3d9f2f0903b2ae49e0108766ed91e819cbe020fee3b0d9a54077ed32942e5990c',
      });
    });

    it('hashes a delete with a collation apart from one without', async () => {
      const plain = new DeleteManyWireCommand('events', filter);
      const collated = new DeleteManyWireCommand('events', filter, {
        collation: { locale: 'simple' },
      });
      expect({
        collation: collated.collation,
        sameHash:
          (await computeMongoContentHash(makeExec({ command: collated }))) ===
          (await computeMongoContentHash(makeExec({ command: plain }))),
      }).toEqual({ collation: { locale: 'simple' }, sameHash: false });
    });
  });

  describe('shape', () => {
    it('returns a fixed-size hashContent digest', async () => {
      const exec = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a' }),
        meta: { storageHash: 'abc' },
      });
      const hash = await computeMongoContentHash(exec);
      expect(hash).toMatch(/^sha512:[0-9a-f]{128}$/);
    });

    it('does not embed the raw command payload in its output (opacity)', async () => {
      const sensitiveValue = 'super-secret-token-1234567890';
      const exec = makeExec({
        command: new InsertOneWireCommand('users', { token: sensitiveValue }),
      });
      const hash = await computeMongoContentHash(exec);
      expect(hash).not.toContain(sensitiveValue);
      expect(hash).not.toContain('users');
    });

    it('produces a fixed-size hash regardless of payload size', async () => {
      const small = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a' }),
      });
      const large = makeExec({
        command: new InsertOneWireCommand('users', { _id: 'a', blob: 'x'.repeat(1_000_000) }),
      });
      expect((await computeMongoContentHash(small)).length).toBe(
        (await computeMongoContentHash(large)).length,
      );
    });
  });
});

describe('computeMongoContentHash with resolved wire commands', () => {
  it('hashes resolved document values, not MongoParamRef instances', async () => {
    const resolved: MongoExecutionPlan = {
      meta: makeMeta(),
      command: new InsertOneWireCommand('users', { token: 'wire-value' }),
    };
    await expect(computeMongoContentHash(resolved)).resolves.toMatch(/^sha512:[0-9a-f]{128}$/);
  });
});
