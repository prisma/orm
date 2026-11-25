---
changes:
  - id: psl-schema-must-be-utf8
    summary: |
      A Prisma schema file that is not valid UTF-8 is now refused with `PSL_SCHEMA_READ_FAILED`, naming the file. Before, each invalid byte was silently replaced with U+FFFD and the file loaded. Reopen each such file in the encoding it was written in, such as Windows-1252, and save it as UTF-8; opening it as UTF-8 and saving keeps the wrong character. If the text is already damaged, restore it from a good copy.
---

# Prisma schema files must be valid UTF-8

## `psl-schema-must-be-utf8`

If `contract emit` or another command now fails with `PSL_SCHEMA_READ_FAILED` and the message says the encoded data is not valid UTF-8, the named schema file contains bytes in another encoding. A common case is a Windows-1252 character, such as an em dash, typed into a comment on Windows.

Reopen the file in the encoding it was written in, for example with your editor's "Reopen with Encoding" set to Windows-1252, then save it as UTF-8 and run the command again. Opening the file as UTF-8 and saving it does not help, because the editor keeps the replacement character instead of the original one. If the text was already saved with replacement characters, restore it from a good copy, such as version control.
