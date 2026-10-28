# ADR 153 — Extension Package Naming Convention

| Status   | Accepted                       |
|----------|--------------------------------|
| Date     | 2025-01-22                     |
| Scope    | Naming conventions             |
| Replaces | —                              |

## Context

The extension pack naming convention previously allowed two patterns for npm package names:

- `@internal/ext-<name>` (shorter form)
- `@internal/extension-<name>` (longer form)

This was documented in `docs/reference/Extension-Packs-Naming-and-Layout.md` with a preference stated for the shorter `ext-` prefix for brevity. However, having two accepted patterns creates ambiguity and inconsistency:

1. **Discoverability**: Users searching for packages may not find all extensions if some use `ext-` and others use `extension-`.
2. **Consistency**: Other package prefixes in the project use full words (`adapter-`, `driver-`, `target-`) rather than abbreviations.
3. **Clarity**: The full `extension-` prefix immediately communicates the package's purpose without requiring knowledge of the abbreviation convention.

## Decision

Use `@internal/extension-<name>` exclusively as the private workspace name for extension packs in this repository. Prisma publishes them under the names ADR 242 gives, and community packages follow ADR 308.

The `ext-*` pattern is deprecated and should not be used for new packages.

### Examples

| Package Purpose | Correct Name | Incorrect Name |
|----------------|--------------|----------------|
| pgvector support | `@internal/extension-pgvector` | `@internal/ext-pgvector` |
| PostGIS support | `@internal/extension-postgis` | `@internal/ext-postgis` |
| SQL views | `@internal/extension-sql-views` | `@internal/ext-sql-views` |

## Rationale

1. **Consistency with other prefixes**: Aligns with `adapter-postgres`, `driver-postgres`, `target-postgres` which all use full words.

2. **Single source of truth**: One pattern eliminates ambiguity in documentation, tooling, and user expectations.

3. **Clarity over brevity**: The few extra characters in `extension-` vs `ext-` provide clearer intent and are negligible in practice.

4. **Search and discovery**: Searching this repository for `@internal/extension-` finds every extension pack.

## Consequences

### Positive

- Clear, unambiguous naming convention
- Better discoverability via npm search
- Consistent with existing package naming patterns
- Easier onboarding for new contributors

### Negative

- Slightly longer import paths (negligible)

### Migration

No migration required — the existing `@internal/extension-pgvector` package already follows this convention. Documentation has been updated to reflect the single-pattern approach.

## Related

- [Extension-Packs-Naming-and-Layout.md](../../reference/Extension-Packs-Naming-and-Layout.md) — Updated naming conventions
- [Package-Naming-Consistency-Report.md](../../reference/Package-Naming-Consistency-Report.md) — Package naming audit
- [ADR 112 - Target Extension Packs](ADR%20112%20-%20Target%20Extension%20Packs.md) — Extension pack architecture
