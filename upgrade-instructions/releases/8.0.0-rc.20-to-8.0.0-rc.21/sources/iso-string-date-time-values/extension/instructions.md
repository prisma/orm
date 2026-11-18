---
changes:
  - id: driver-ensures-target-session-settings
    summary: |
      A target descriptor may declare `sessionSettings`, the settings its codecs need on every database session; the PostgreSQL target declares `DateStyle=ISO`. A stack passes them to each driver it creates: a runtime driver descriptor's `create(options, sessionSettings)` receives them as a second argument, and a control driver's connect options carry them as `sessionSettings`. A driver for a target that declares them must ensure them on every connection it hands out. A wrapper around a driver descriptor's `create` passes `sessionSettings` on.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$])(?:RuntimeDriverDescriptor|ControlDriverDescriptor)(?![\w$])'
---

# A driver ensures the session settings its target declares

A target can now state the settings every database session needs, as data on its descriptor:

```ts
const target = { ...meta, sessionSettings: { DateStyle: 'ISO' } };
```

`createExecutionStack` and `createControlStack` pass them to the driver. A runtime driver descriptor receives them as the second argument of `create`, after its own options; a control driver receives them in its connect options:

```ts
create(options?: MyDriverOptions, sessionSettings?: SessionSettings): MyDriver
create(url: string, options?: ControlDriverConnectOptions): Promise<MyControlDriver> // options.sessionSettings
```

A driver for a target that declares settings applies them to every connection it hands out, before the first statement, and again whenever a connection's session may have been reset. A driver for a target that declares none needs no change. Code that wraps a driver descriptor to curry its options passes the second argument on, or the driver never receives the settings:

```ts
const driverWithCursor = {
  ...postgresDriverDescriptor,
  create(_options, sessionSettings) {
    return postgresDriverDescriptor.create({ cursor }, sessionSettings);
  },
};
```

A codec whose application value is the stored form of its data type builds its values with the new `CodecImpl.storedDataTypeValueOf`, which takes only the stored spelling, instead of `dataTypeValueOf`.
