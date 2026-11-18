import * as mysqlContractBuilder from '@internal/mysql/contract-builder';
import { describe, expect, it } from 'vitest';
import * as mariadbContractBuilder from '../src/exports/contract-builder';

describe("MariaDB's contract-builder entry", () => {
  it("exports every value MySQL's exports, except the factory that builds a target's defineContract", () => {
    const mysqlNames = Object.keys(mysqlContractBuilder)
      .filter((name) => name !== 'createMysqlDefineContract')
      .sort();
    expect(Object.keys(mariadbContractBuilder).sort()).toEqual(mysqlNames);
  });
});
