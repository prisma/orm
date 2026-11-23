# Research: additions that break existing code

Every claim was checked against the source linked beside it. Nothing here is a decision or a proposal for Prisma.

## 1. A new case in a set that user code handles exhaustively

**Treat it as breaking**

- Rust: "It is a breaking change to add a new enum variant if the enum does not use the `#[non_exhaustive]` attribute." ([Cargo SemVer reference](https://doc.rust-lang.org/cargo/reference/semver.html))
- Kubernetes: "Adding a new value to an enumerated set is *not* a compatible change." ([api_changes](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-architecture/api_changes.md))

**Declare the set open from the start**

- Rust `#[non_exhaustive]`: "When introducing the enum, mark it as `#[non_exhaustive]` to force users to use wildcard patterns". Adding the attribute later is itself a major change. (same reference)
- Kubernetes: for fields that will gain values, "document that expectation clearly in the API field description in the first release the field is made available, and describe how clients should treat an unknown value." If not done in the first release, "it is not safe to add new values". (same api_changes)
- Stripe marks each enum closed or open; for an open enum "Stripe can add new values as a backward-compatible change", and readers must have "a safe fallback" ([docs](https://docs.stripe.com/api/enums.md)).
- GitHub REST lists "Adding enum values" as additive ([docs](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes)).
- Smithy: "Unions in Smithy are considered "open"; it is a backward-compatible change to add new members to a union." ([guide](https://smithy.io/2.0/guides/evolving-models.html))
- Language Server Protocol: "the using side of an enumeration shouldn't fail on an enumeration value it doesn't know." ([spec](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/))
- typescript-eslint: a change is not breaking if it "Adds a new node type to the AST. Adds a new node type to an existing union type." ([versioning](https://typescript-eslint.io/users/versioning/))

**Put a catch-all member into the TypeScript type**

- AWS SDK for JavaScript v3: each generated union includes `$UnknownMember { $unknown: [string, any] }` ([source](https://github.com/aws/aws-sdk-js-v3/blob/main/clients/client-bedrock-runtime/src/models/models_0.ts)).
- Relay appends `"%future added value"` to every enum type generated from the server schema ([source](https://github.com/facebook/relay/blob/main/compiler/crates/relay-typegen/src/lib.rs)). Its opt-out warns that without it "you will have to update your application whenever the GraphQL server schema adds new enum values".

**Allowed, flagged as risky**

- graphql-js classifies `VALUE_ADDED_TO_ENUM` and `TYPE_ADDED_TO_UNION` as "Dangerous", not breaking ([source](https://github.com/graphql/graphql-js/blob/16.x.x/src/utilities/findBreakingChanges.ts)).

In TypeScript itself: the handbook's `never` check makes a new union member a compile error on purpose ([handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)).

## 2. A new built-in name that collides with a user's name

- **Opt-in language versions.** Rust editions ([guide](https://doc.rust-lang.org/edition-guide/editions/index.html)); Python `__future__` ([docs](https://docs.python.org/3/library/__future__.html)).
- **An escape syntax for user names.** Rust raw identifiers ([reference](https://doc.rust-lang.org/reference/identifiers.html)); quoting in PostgreSQL ([docs](https://www.postgresql.org/docs/current/sql-keywords-appendix.html)).
- **Keywords that apply only in context.** Python soft keywords ([docs](https://docs.python.org/3/reference/lexical_analysis.html)); PostgreSQL non-reserved keywords; TypeScript contextual keywords such as `satisfies` and `using` ([source](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/types.ts)).
- **A user's own name wins over a built-in.** Smithy resolves a name to the user's shapes first and to the built-in prelude last ([spec](https://smithy.io/2.0/spec/idl.html)).
- **Reserve a namespace up front.** GraphQL reserves names starting with `__` ([spec](https://spec.graphql.org/October2021/)); Terraform reserves a fixed list of variable names ([docs](https://developer.hashicorp.com/terraform/language/v1.11.x/values/variables)).
- **Accept the risk and name the pattern to avoid.** Go on `import .` ([doc](https://go.dev/doc/go1compat)); Rust on glob imports (Cargo SemVer reference); semver-ts: a new export is non-breaking only if it "does not share a name with another symbol which was previously exported" ([spec](https://www.semver-ts.org/formal-spec/3-non-breaking-changes.html)).

## 3. Newer data read by an older component

- **The reader preserves or ignores what it does not know.** Protocol Buffers ([docs](https://protobuf.dev/programming-guides/proto3/)); LSP: "Clients should ignore server capabilities they don't understand".
- **The producer holds back until old readers can cope.** Kubernetes: a new enum value "must be handled safely by kubelets up to three versions older"; first allow it only on objects that already contain it (api_changes above).
- **The consumer declares which version it understands.** VS Code `engines.vscode` ([docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)); Terraform plugin protocol: "Minor versions of the protocol are additive" ([docs](https://developer.hashicorp.com/terraform/plugin/terraform-plugin-protocol)); typescript-eslint warns on an unsupported TypeScript version ([docs](https://typescript-eslint.io/users/dependency-versions/)).
- **New node kinds are allowed in a minor release.** typescript-eslint (versioning above); ESLint: a minor may include "A new addition to an existing rule to support a newly-added language feature" ([README](https://github.com/eslint/eslint/blob/main/README.md)).

## Not confirmed

- Rules for reserved or built-in names in Rails, Drizzle, Hasura, Gel, CUE, Thrift.
- How Babel, PostCSS, webpack, Rollup and Vite treat new node types or unknown plug-in options.
- What semver-ts says about adding enum or union members; it does not mention them.
- How PSL resolves a user's model or type name that matches a built-in type name today. Not determined from the code.
