<!--
Copy this file to a new kebab-case slug under `docs/architecture docs/patterns/` and fill it in.
Replace every `<...>` placeholder. Delete optional sections you do not use.

Writing guidance — read this before drafting:

- **Lead with a grounding example.** The Intent section should open with a concrete situation in the codebase a fresh reader can hold in their head. Avoid abstract definition until after the reader has a picture.
- **State the decision in plain language second.** What does the pattern tell a contributor to do? One or two sentences, no jargon-stacking.
- **Cut "Adopting this pattern commits you to..." style paragraphs.** Constraints belong in "When NOT to use" and "Cautions" where the reader can act on them.
- **Don't address one audience inside the prose** ("Architect-persona check:", "we used to ...", "v1 catalogue ships ..."). Pattern docs are long-lived; if a sentence only makes sense to a specific reader at a specific moment, cut or rephrase it.
- **Single-line prose paragraphs.** No fixed-column hard wraps; let editors and viewers reflow.
-->

# Pattern: `<Title>`

**Status:** Stable | Emerging
**Maintainer:** `<persona/team — usually "architect">`

## Intent

`<Open with a grounding example: a real situation in the codebase a fresh reader can pin understanding to. Then state in 1–2 plain sentences what the pattern tells a contributor to do. No abstract framing before the example.>`

## When to use

- `<Concrete conditions a reader can verify against their own case. Avoid placeholder words like "consumers" or "the framework" without anchoring.>`

## When NOT to use

- `<Cases where another pattern is the right fit, with a pointer to which one. This section is critical — patterns without a clearly-stated "not this case" tend to over-apply.>`

## Structure

`<The shape. Types, layers, interfaces, contracts — whichever language fits. Lift concrete code from a real reference implementation when it grounds the abstraction faster than prose. Diagrams welcome but only when they earn the space.>`

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| `<name>` | [`<repo-relative path>`](../../../) | `<one-sentence note on what it demonstrates>` |

## Related ADRs

- `<ADRs that decided to adopt this pattern, codified its boundaries, or whose decision is an instance of this pattern.>`

## Related patterns

- `<Patterns that compose with this one (link to other catalogue entries), patterns that are alternatives, patterns this one supersedes.>`

## Related rules

<!-- Optional. Cursor rules under [`.agents/rules/`](../../../.agents/rules/) that enforce or otherwise relate to this pattern. Delete this section if there are none. -->

- `<rule path>` — `<one-line note>`

## Cautions / common mistakes

<!-- Optional but recommended. Mistakes the codebase has seen this pattern attract. State the mistake plainly; do not address a specific reviewer audience. Delete this section if there are none. -->

- `<caution>`
