import { ArkErrors as ArkErrors$1 } from "arktype";
interface ArkErrors {
  readonly own: true;
}
declare function viaImport(errors: import("arktype").ArkErrors): void;
declare function viaNamed(errors: ArkErrors$1): void;
export { ArkErrors, viaImport, viaNamed };
