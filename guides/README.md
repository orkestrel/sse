# Guides

A dual-axis index into this repository's guides — by concept, and by directory (AGENTS.md, Documentation contract).

## By concept

| Concept | Spec               | Source                    | Tests                                 |
| ------- | ------------------ | ------------------------- | ------------------------------------- |
| SSE     | [`sse.md`](sse.md) | [`src/core`](../src/core) | [`tests/src/core`](../tests/src/core) |

## By directory

| Directory  | Guide              |
| ---------- | ------------------ |
| `src/core` | [`sse.md`](sse.md) |

## Dependency reference

[`contract.md`](contract.md) is a byte-identical mirror of the guide for `@orkestrel/contract` — this
package's runtime dependency. It documents **that package's** surface, not anything sourced in this
repository.

The other mirrors are the guides of the devDependencies the suites and the toolchain use.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity
test suite (`tests/guides.test.ts`). It documents **that
package's** surface (`Guide` / `Source`, the manifest and comparison
helpers), not anything sourced in this repo; it is kept here so a reader of
the parity suite can see the primitives it is built from without leaving
this guide set. [`probe.md`](probe.md), [`scaffold.md`](scaffold.md), and [`test.md`](test.md)
are the same kind of mirror for the other devDependencies.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules, including the documentation contract.
