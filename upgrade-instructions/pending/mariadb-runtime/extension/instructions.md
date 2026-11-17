---
changes:
  - id: mysql-driver-factories-take-the-target
    summary: |
      `createMysqlRuntimeDriverDescriptor` and `createMysqlControlDriverDescriptor`, which build the MySQL driver for a target that extends MySQL, take an options object whose `target` is the target's runtime metadata, from which the drivers take their target id and the display name their errors show, as in `createMysqlRuntimeDriverDescriptor({ target: mariadbTargetDescriptorMetaRuntime })`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'createMysql(?:Runtime|Control)DriverDescriptor\(\s*[''"`]'
---

# The MySQL driver factories take the target's runtime metadata

Find each call to `createMysqlRuntimeDriverDescriptor` or `createMysqlControlDriverDescriptor` that passes a target id, and pass the target's runtime metadata instead, which carries its `targetId` and its `displayName`:

```ts
// was createMysqlRuntimeDriverDescriptor('mariadb')
const driver = createMysqlRuntimeDriverDescriptor({ target: mariadbTargetDescriptorMetaRuntime });
```

A target without metadata of its own passes an object with the two fields: `{ target: { targetId: 'mariadb', displayName: 'MariaDB' } }`.
