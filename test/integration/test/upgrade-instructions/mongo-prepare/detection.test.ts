import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const EXTENSION_NOTE = 'upgrade-instructions/pending/mongo-prepare/extension/instructions.md';

const matcher = (id: string) => (content: string) =>
  detectionPatterns(EXTENSION_NOTE, id).some((pattern) => pattern.test(content));

describe('the mongo-runtime-has-prepare detection', () => {
  const matches = matcher('mongo-runtime-has-prepare');

  it('matches a hand-written runtime or client, and not a cast or a use', () => {
    expect([
      matches('const runtime: MongoRuntime = {\n  query,\n  execute,\n};'),
      matches('const db: MongoClient<Contract> = { orm, query };'),
      matches('class FakeRuntime implements MongoRuntime {}'),
      matches('const runtime = fake as unknown as MongoRuntime;'),
      matches('const runtime: MongoRuntime = await db.runtime();'),
      matches('function run(runtime: MongoRuntime) {}'),
    ]).toEqual([true, true, true, false, false, false]);
  });
});

describe('the mongo-limit-skip-take-placeholders detection', () => {
  const matches = matcher('mongo-limit-skip-take-placeholders');

  it('matches code that reads limit or skip stages or handles MongoValue, and not other stages', () => {
    expect([
      matches('if (stage instanceof MongoLimitStage) total = stage.limit;'),
      matches('const skip = (stage as MongoSkipStage).skip;'),
      matches('function walk(value: MongoValue) {}'),
      matches('new MongoSampleStage(5);'),
    ]).toEqual([true, true, true, false]);
  });
});
