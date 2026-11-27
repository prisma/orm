import { QueryResult } from "pg";
declare function viaImport(result: import("pg").QueryResult): void;
declare function viaNamed(result: QueryResult): void;
export { QueryResult, viaImport, viaNamed };
