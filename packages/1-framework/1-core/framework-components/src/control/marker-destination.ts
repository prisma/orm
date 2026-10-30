import type { DatabasePolicies } from './database-policies';

/** What a marker write records for a space. */
export interface MarkerDestination {
  readonly storageHash: string;
  readonly profileHash: string;
  /** Written verbatim when supplied, merged with the stored ones by an update; left as stored when omitted. */
  readonly invariants?: readonly string[];
  /** Recorded in `meta.policies` when supplied; the rest of `meta` is left as stored. */
  readonly databasePolicies?: DatabasePolicies;
}
