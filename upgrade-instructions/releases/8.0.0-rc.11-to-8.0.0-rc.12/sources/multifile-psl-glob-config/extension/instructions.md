---
# The postgres/sqlite/mongo defineConfig wrappers accept a glob-shaped
# `contract:` string (e.g. `./prisma/**/*.prisma`) and derive the default
# output from its static prefix directory. Purely additive: every existing
# single-path `contract:` value keeps deriving its output exactly as before.
# Nothing for an extension author to translate.
changes: []
---
