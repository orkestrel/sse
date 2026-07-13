# @orkestrel/sse

A typed Server-Sent Events parser — incremental, spec-compliant parsing of
event-stream chunks into typed events with `data`, `event`, `id`, and `retry`
fields. Feed it string chunks as they arrive; a blank line dispatches the
accumulated event, and a partial line or in-progress event split across
chunk boundaries is buffered until the rest arrives. A pure functional
primitive — no Emitter, no events, no server / HTTP / agent coupling; it
never throws on malformed input. Part of the `@orkestrel` line.

## Install

```sh
npm install @orkestrel/sse
```

## Requirements

- Node.js >= 24
- ESM + CJS (dual-format build)
- No runtime dependencies

## Usage

```ts
import { createSSEParser } from '@orkestrel/sse'

const parser = createSSEParser()
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\ndata: 1') // [] - buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping' }]

parser.reset() // drop any buffered partial line / in-progress event
```

Pair it with a `TextDecoder({ stream: true })` when reading a byte stream so
multi-byte UTF-8 characters split across reads are handled — the decoder
handles partial characters, this parser handles partial lines and events.

## Guide

For the full surface — the `SSEParser` class, its `SSEEvent` shape, the wire
format it implements, and the `createSSEParser` factory — see
[`guides/src/sse.md`](guides/src/sse.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
