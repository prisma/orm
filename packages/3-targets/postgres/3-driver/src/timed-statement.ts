import type { QueryConfig } from 'pg';

/** A statement config with pg's per-statement time limit, which `@types/pg` leaves out. */
interface TimedQueryConfig extends QueryConfig {
  readonly query_timeout: number;
}

/** `statement` with a time limit of its own; the client's other statements keep theirs. */
export function timedStatement(statement: QueryConfig, timeLimitMillis: number): TimedQueryConfig {
  return { ...statement, query_timeout: timeLimitMillis };
}
