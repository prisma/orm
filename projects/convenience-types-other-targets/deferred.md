# Deferred

- **MySQL fills an unwritten precision only into the storage column.** A `datetime`, `timestamp` or `time` column written without a precision gets `precision: 0` in its storage column when the namespace is built, so its writes are cut to whole seconds. The model field keeps no precision, so `TimeString` and `TimeString(0)` give contracts that differ in the field only. Nothing encodes from the field, so no value is wrong. Enum members are filled the same way. Revisit if a consumer reads precision from the field.
