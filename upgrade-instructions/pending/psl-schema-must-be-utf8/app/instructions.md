---
changes:
  - id: psl-schema-must-be-utf8
    summary: |
      A Prisma schema file that is not valid UTF-8 is now refused with `PSL_SCHEMA_READ_FAILED`, naming the file. Before, each invalid byte was silently replaced with U+FFFD and the file loaded. Re-save each such schema file as UTF-8.
---

# Prisma schema files must be valid UTF-8

## `psl-schema-must-be-utf8`

If `contract emit` or another command now fails with `PSL_SCHEMA_READ_FAILED` and the message says the encoded data is not valid UTF-8, the named schema file contains bytes in another encoding. A common case is a Windows-1252 character, such as an em dash, typed into a comment on Windows.

Open the file named in the message and re-save it as UTF-8, then run the command again. Any character that was written in the other encoding may need to be typed again after re-saving.
