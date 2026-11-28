declare const Role: readonly ["a", "b"];
type Role = (typeof Role)[number];
declare function pick(role: Role): void;
declare function all(): typeof Role;
export { all, pick };
