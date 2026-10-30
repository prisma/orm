import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const guide = (audience: 'app' | 'extension') =>
  `upgrade-instructions/pending/mongo-driver-from-stack/${audience}/instructions.md`;
const rootPackage = ['@internal', 'driver-mongo'].join('/');
const facadeDriver = ['@prisma', 'orm-mongo', 'driver'].join('/');

function detects(audience: 'app' | 'extension', id: string, content: string): boolean {
  return detectionPatterns(guide(audience), id).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)(
  'the %s removed-driver-export detection',
  (audience) => {
    const id = 'mongo-driver-from-runtime-descriptor';

    it.each([
      ['an import of createMongoDriver', `import { createMongoDriver } from '${facadeDriver}';`],
      ['a call of createMongoDriver', 'const driver = await createMongoDriver(url, dbName);'],
      ['a call of MongoDriverImpl.fromDb', 'const driver = MongoDriverImpl.fromDb(db);'],
      [
        'a CommonJS require of createMongoDriver',
        `const { createMongoDriver } = require('${facadeDriver}');`,
      ],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['the runtime descriptor', `import mongoRuntimeDriver from '${facadeDriver}/runtime';`],
      ['a longer name', 'createMongoDriverPool(url)'],
      ['a name that ends the same', 'myMongoDriverImpl.fromDb(db)'],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  },
);

describe('the extension root-import detection', () => {
  const id = 'mongo-driver-from-runtime-descriptor';

  it('finds an import of the root package', () => {
    expect(detects('extension', id, `import * as driver from '${rootPackage}';`)).toBe(true);
  });

  it.each([
    ['the runtime entry point', `import mongoRuntimeDriver from '${rootPackage}/runtime';`],
    ['the control entry point', `import mongoControlDriver from "${rootPackage}/control";`],
  ])('skips %s', (_name, content) => {
    expect(detects('extension', id, content)).toBe(false);
  });
});

describe('the extension MongoDriver and MongoQueryable detection', () => {
  const id = 'mongo-driver-connect';

  it.each([
    ['a class that implements it', 'class StubMongoDriver implements MongoDriver {'],
    [
      'a class that implements it among others',
      'class Stub extends Base implements Other, MongoDriver {',
    ],
    ['an object literal typed with it', 'const driver: MongoDriver = {'],
    ['an object literal typed with a binding', 'const driver: MongoDriver<Binding> = {'],
    ['an object literal checked with it', '}) satisfies MongoDriver;'],
    ['a parameter typed with it', 'async executeDdl(driver: MongoDriver, command: Command) {'],
    ['an optional field typed with it', '  readonly driver?: MongoDriver;'],
    ['a return type', 'function createMockDriver(): MongoDriver {'],
    ['a promised return type', 'async function createDriver(): Promise<MongoDriver> {'],
    [
      'a field typed with a generic of it',
      '  readonly drivers: ReadonlyArray<MongoDriver<Binding>>;',
    ],
    ['an interface that extends it', 'interface CustomDriver extends MongoDriver {'],
    [
      'an interface that extends it with a binding',
      'export interface CustomDriver extends Other, MongoDriver<Binding> {',
    ],
    ['a type alias that names it', 'type CustomDriver = MongoDriver & { readonly name: string };'],
  ])('finds %s', (_name, content) => {
    expect(detects('extension', id, content)).toBe(true);
  });

  it.each([
    ['a parameter typed with MongoQueryable', 'async executeDdl(driver: MongoQueryable) {'],
    ['a cast to it', '} as unknown as MongoDriver;'],
    ['a longer name', 'class Stub implements MongoDriverFactory {'],
    ['a type argument', 'const drivers = new Map<string, MongoDriver>();'],
    ['a promised MongoQueryable', 'async function createDriver(): Promise<MongoQueryable> {'],
    ['a generic of a longer name', 'function create(): Promise<MongoDriverFactory> {'],
    ['an interface that extends MongoQueryable', 'interface CustomDriver extends MongoQueryable {'],
    [
      'an interface that extends a longer name',
      'interface CustomDriver extends MongoDriverFactory {',
    ],
    ['a type alias of MongoQueryable', 'type CustomDriver = MongoQueryable;'],
  ])('skips %s', (_name, content) => {
    expect(detects('extension', id, content)).toBe(false);
  });
});
