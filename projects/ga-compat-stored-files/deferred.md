# Deferred

- **Marker warnings are silent by default.** The SQL runtime's default logger does nothing, so the warnings from the marker check (mismatch, missing, and now unreadable) are seen only when the application passes a `log` option. Whether the default should print warnings is a question for the runtime's logging, outside this project. Found 2026-11-24 while rechecking the code.
- **MongoDB snapshots are read without a content check.** The MongoDB family publishes no hash canonicalization hooks, with a comment that MongoDB hashes a projection of storage. The comment may be out of date. Found 2026-11-24.
- **`apps/telemetry-backend/migrations/snapshots/`** holds three snapshots in formats several releases old that nothing reads or regenerates.
