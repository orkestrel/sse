# @orkestrel/sse

A typed Server-Sent Events parser — incremental, spec-compliant parsing of
event-stream chunks into typed events with `data`, `event`, `id`, and `retry`
fields. Feed it string chunks as they arrive; a blank line dispatches the
accumulated event, and a partial line or in-progress event split across
chunk boundaries is buffered until the rest arrives. The `id` / `retry`
fields also persist as sticky connection state — surfaced via the `id` /
`retry` getters for reconnection — and an optional `limit` bounds total
buffered characters. A pure functional primitive — no Emitter, no events, no
server / HTTP / agent coupling; it never throws on malformed input, only a
typed `SSEError('OVERFLOW')` when a configured `limit` is exceeded. Part of
the `@orkestrel` line.

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
import { createSSEParser, isSSEError } from '@orkestrel/sse'

const parser = createSSEParser({ limit: 1_000_000 })
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\ndata: 1') // [] - buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping' }]

parser.id // '1' - sticky last-event-id, survives dispatch
parser.retry // undefined - sticky reconnection time, until a retry: field arrives

try {
	parser.parse('x'.repeat(2_000_000))
} catch (error) {
	if (isSSEError(error) && error.code === 'OVERFLOW') parser.reset()
}

parser.flush() // force out a trailing unterminated event at end-of-stream
parser.reset() // full reset - drops buffered state and sticky id/retry
```

Pair it with a `TextDecoder({ stream: true })` when reading a byte stream so
multi-byte UTF-8 characters split across reads are handled — the decoder
handles partial characters, this parser handles partial lines and events.

The optional `limit` option caps total buffered characters; when set, a
`parse(chunk)` call that would exceed it throws a typed `SSEError('OVERFLOW')`
instead of growing unbounded, leaving parser state unchanged. Without
`flush()`, a stream that ends without a final blank line has its last event
discarded per spec — call `flush()` at end-of-stream to force it out.

## Guide

For the full surface — the `SSEParser` class, its `SSEEvent` shape, the wire
format it implements, and the `createSSEParser` factory — see
[`guides/src/sse.md`](guides/src/sse.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
