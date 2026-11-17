# Extensions Glossary

This glossary defines key terms related to Prisma 8's extensions, packs, and capabilities model.

## Core Concepts

### Data Contract
A canonical, verifiable JSON artifact that describes an application's data model, relationships, invariants, and policies. The data contract serves as a binding agreement between the application and database, and declares **required capabilities** under `contract.capabilities`. Serialized as `contract.json` and includes `storageHash`, optional `executionHash`, and optional `profileHash`.

### StorageHash
A SHA-256 hash of the meaningful storage components (storage layout and related structural inputs) that represent the schema’s storage contract. Changes to schema structure that require migrations affect the `storageHash`. Used for contract verification and migration planning.

### ExecutionHash
A SHA-256 hash of execution defaults (for example, execution-time defaults or policies encoded under the `execution` section). Used to detect drift in execution semantics without altering the storage hash.

### ProfileHash
A SHA-256 hash of the pinned capability profile derived from declared requirements, negotiated adapter capabilities, and optional adapter pins. It does not change the logical meaning of the data contract. The migration runner verifies that the database satisfies these requirements and writes the same `profileHash` to the marker. At runtime, equality with the marker is enforced.

### Capability Key
A canonical identifier for a database or extension feature (e.g., `sql.lateral`, `sql.returning`, `pgvector.ivfflat`). Capability keys are namespaced and follow a stability contract where core capabilities are reserved and extension capabilities are prefixed by pack namespace. Used for adapter negotiation and feature gating.

### Extension Pack
A versioned, installable npm package that extends Prisma 8 with domain-specific features like vector search (pgvector) or geospatial operations (PostGIS). Packs declare a namespace, provide schemas for contract decorations, and implement SPIs for authoring, runtime, and migration integration.

### Bundle
A self-contained artifact for hosted preflight containing `contract.json`, migration edges, pack code as ESM files, and pack manifests. Bundles ensure deterministic execution with all dependencies inlined and no network access, enabling safe execution in sandboxed environments.

### Plan Annotations
Structured metadata attached to query Plans that enable policy checks and verification without parsing SQL. Include intent (`read`/`write`/`admin`), sensitivity levels, budget constraints, and extension-specific claims. Required for raw SQL Plans to maintain safety guarantees.

### Codec
A deterministic encoder/decoder pair for converting between JavaScript values and database wire formats. Extension codecs handle domain-specific types like vectors or geometries, providing lossless round-trip conversion and branded TypeScript types for type safety.

### Branded Type
A TypeScript nominal type that carries semantic information about extension values (e.g., `Vector<1536>`, `Geography`). Branded types prevent mixing incompatible extension values and enable compile-time verification of extension usage.

## Extension Architecture

### Namespace
A lowercase identifier (`^[a-z][a-z0-9_-]*$`) that uniquely identifies an extension pack. Each pack owns exactly one namespace and must not collide with core attributes or other packs. Used for PSL constructor paths (`pgvector.Vector(...)`) and contract organization.

### Contract Extensions
A section in `contract.json` under `extensions.<namespace>` containing pack-specific decorations and constructs. Includes version pinning, capability claims, decorations (metadata attached to core nodes), and constructs (extension-owned entities).

### Decorations
Structured metadata attached to existing core nodes (tables, columns, indexes) via stable references. Decorations are advisory and interpretable by adapters and tools without mutating core node keys.

### Constructs
Extension-owned entities referenced by name within a namespace (e.g., operator classes, custom codecs). Constructs are validated by pack schemas and can be referenced by decorations or used by adapters during lowering.

### Capability Negotiation
The process by which adapters advertise supported capabilities and runtimes verify that contract requirements are satisfied. Occurs at `connect()` time and fails early with stable error codes if required capabilities are missing.

### Pack Manifest
A JSON document declaring pack metadata including namespace, version, supported targets, capabilities, entry points, and security policies. Required for pack discovery, validation, and integration with the Prisma 8 toolchain.

## Runtime Integration

### Profile Selection
The process of selecting an adapter profile based on engine version and features, with profiles pinned in `profileHash`. Determines which capabilities are available and how queries are lowered to SQL.

### Codec Resolution
The deterministic process of assembling active codecs with strict precedence: app-provided → pack codecs → adapter built-ins → driver fallbacks. Resolution is cached per contract type and adapter profile.

### Extension Guardrails
Policy enforcement for extension usage including capability gating, budget constraints, and security sandboxing. Guardrails prevent unsafe operations and ensure deterministic behavior across environments.

### Bundle Validation
Security checks for preflight bundles including integrity verification, policy compliance (no network, no WASM), and capability requirements. Bundles must pass validation before execution in hosted environments.

## Authoring and Development

### PSL Extension Syntax
The extension-owned syntax slots available in Prisma Schema Language. In the current SQL PSL surface this primarily means namespaced constructor expressions such as `pgvector.Vector(length: 1536)`. Other namespaced attribute forms are not broadly supported yet and are treated as strict errors unless explicitly implemented.

### TS Builder Integration
TypeScript helpers for extension authoring that produce identical contract JSON to PSL-first mode. Includes typed decorators and extension registration APIs for pack integration.

### Function Registry
A catalog of extension functions and operators with signatures, type inference rules, and rendering hooks. Registry enables type-safe usage of extension features in query DSLs.

### Canonicalization
Deterministic normalization of extension data for stable hashing and cross-platform compatibility. Includes key ordering, scalar normalization, and array ordering semantics per pack schema.

## Migration and Deployment

### Extension-Aware Migrations
Migration operations that understand extension capabilities and gate execution on pack availability. Includes pre/post checks for extension-specific constraints and rollback strategies.

### Bundle Signing
Cryptographic signatures for preflight bundles ensuring integrity and authenticity. Required for production preflight and enables secure execution in hosted environments.

### Capability Gating
Policy enforcement that prevents migration operations requiring unavailable capabilities. Operations fail early with clear error messages and remediation hints.

### Profile Parity
Verification that local and hosted environments have compatible capability profiles. Ensures preflight results are representative of production behavior.

## Security and Compliance

### Sandbox Constraints
Execution limits for extension code including no network access, no WASM engines, and resource caps. Enforced in hosted preflight and bundle execution environments.

### Redaction Policy
Privacy controls for extension diagnostics including parameter masking, column name obfuscation, and sensitivity-based filtering. Configurable per environment and compliance requirements.

### Audit Trail
Structured logging of extension usage including capability checks, codec operations, and policy enforcement decisions. Enables compliance reporting and security monitoring.

### Trust Model
Security boundaries between core Prisma 8, extension packs, and hosted services. Defines what code can execute where and under what constraints.
