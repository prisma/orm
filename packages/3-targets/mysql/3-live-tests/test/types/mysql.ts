import type { Contract } from '../fixtures/mysql/generated/contract.d';

/** The contract the live suites run with, as the mysql target's emitter types it. */
export type LiveContract = Contract;

export type LiveTargetId = 'mysql';
