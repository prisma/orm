import type { Contract } from '../fixtures/mariadb/generated/contract.d';

/** The contract the live suites run with, as the mariadb target's emitter types it. */
export type LiveContract = Contract;

export type LiveTargetId = 'mariadb';
