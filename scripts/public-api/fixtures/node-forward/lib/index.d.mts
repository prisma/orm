import { ReadStream } from "node:fs";
declare function viaNamed(stream: ReadStream): void;
declare function viaImport(stream: import("node:fs").ReadStream): void;
export { ReadStream, viaImport, viaNamed };
