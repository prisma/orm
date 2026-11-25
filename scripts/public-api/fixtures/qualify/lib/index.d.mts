import { ArkErrors as ArkErrors$1 } from "arktype";
interface ArkErrors {
  readonly own: true;
}
declare function check(errors: ArkErrors$1): ArkErrors;
declare function legacy(errors: import("arktype").ArkErrors): void;
export { ArkErrors, check, legacy };
