import { flag } from '@prisma/cli-engine';

/**
 * The database connection override, declared from here by every command that
 * accepts one so its brief and placeholder cannot drift apart. Resolution
 * order is the flag, then `config.db.connection`, then
 * `CONFIG.DB_CONNECTION_REQUIRED`.
 */
export const dbFlag = flag.string({
  brief: 'Database connection string',
  placeholder: 'url',
});

/** Consent for `db migrate` and `db update` to write the ref's declared policies into the database. */
export const permitPolicyChangeFlag = flag.boolean({
  brief:
    "Check the run against the ref's declared policies and write them into the database when it succeeds",
});
