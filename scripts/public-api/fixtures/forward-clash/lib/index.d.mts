import { ArkErrors } from "arktype";
export { ReadStream } from "node:fs";
declare function terminal(stream: import("node:tty").ReadStream): void;
declare function check(errors: ArkErrors): void;
export { ArkErrors, check, terminal };
