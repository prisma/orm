// Facade over `@internal/target-sqlite/codec-types` so downstream consumers (demo, e2e tests, generated contract `.d.ts`) can keep importing from `@internal/adapter-sqlite/codec-types` after codecs moved target-side.
export type { CodecTypes, JsonValue } from '@internal/target-sqlite/codec-types';
