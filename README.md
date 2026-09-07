# @orkestrel/sse

> A stateful Server-Sent-Events (SSE) stream parser: a handle that turns string chunks into
> the complete events a blank line has dispatched, buffering a partial line or in-progress
> event until the rest arrives and persisting the sticky `id` / `retry` connection state.

Create a parser with the `createSSEParser` function, feed it the chunks your transport hands
you, and read the dispatched events off each `parse(chunk)` return. Part of the `@orkestrel`
line.

## Install

```sh
npm install @orkestrel/sse
```

## Requirements

- Node.js >= 22.12.0
- ESM + CJS (dual-format build)
- No runtime dependencies

## Usage

```ts
import { createSSEParser, isSSEError } from '@orkestrel/sse'

const parser = createSSEParser({ limit: 1_000_000 })
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\nid: 7\ndata: 1') // [] - buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping', id: '7' }]

parser.id // '7' - sticky last-event-id, survives dispatch
parser.retry // undefined - sticky reconnection time, until a retry: field arrives

try {
	parser.parse('x'.repeat(2_000_000))
} catch (error) {
	if (isSSEError(error) && error.code === 'OVERFLOW') parser.clear()
}

parser.flush() // force out a trailing unterminated event at end-of-stream
parser.clear() // drops buffered state and sticky id/retry
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
[`guides/sse.md`](guides/sse.md).

## Package

Published as a single typed entry point per the `exports` field in
`package.json`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
