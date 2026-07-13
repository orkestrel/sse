# SSE

> A stateful Server-Sent-Events (SSE) stream parser: feed it string chunks, get
> back the complete events dispatched so far. SSE is a UTF-8 text stream of
> events separated by a blank line; within an event each `field: value` line
> accumulates onto an in-progress event — multiple `data:` lines concatenate
> with `\n`, `event:` / `id:` / `retry:` are last-wins — and a blank line
> DISPATCHES the accumulated event, but only when its data buffer is
> non-empty. A trailing partial line or in-progress event split across chunk
> boundaries is buffered until the rest arrives. A pure functional primitive —
> no Emitter, no server / HTTP / agent coupling, never throws on malformed
> input. Source: [`src/core`](../../src/core). Surfaced through the
> `@src/core` barrel.

## Surface

Create a parser and feed it chunks as they arrive; each `parse(chunk)`
returns the events a blank line has dispatched so far, and an in-progress
event / trailing partial line is held for the next call:

```ts
import { createSSEParser } from '@orkestrel/sse'

const parser = createSSEParser()
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\ndata: 1') // [] - the event is buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping' }]
parser.reset() // drop any buffered partial line / event - ready for a fresh stream
```

### Types

| Type                 | Kind      | Shape                                                                                                                      |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SSEEvent`           | interface | `{ data, event?, id?, retry? }` — one dispatched event; `data` is every `data:` field joined by `\n`, no trailing newline. |
| `SSEParserInterface` | interface | The stateful stream-parser contract — `parse` / `reset`.                                                                   |

### Constants

| API   | Kind  | Summary                                                                                                          |
| ----- | ----- | ---------------------------------------------------------------------------------------------------------------- |
| `NUL` | const | The NUL byte (`U+0000`) — an `id:` field containing it is voided per spec and never surfaced.                    |
| `BOM` | const | The byte-order mark (`U+FEFF`) — stripped from the very first chunk of a stream; ordinary content on later ones. |

```ts
import { BOM, NUL } from '@orkestrel/sse'

NUL.charCodeAt(0) // 0
BOM.charCodeAt(0) // 0xfeff
```

### Factories

| API               | Kind     | Builds…                                                |
| ----------------- | -------- | ------------------------------------------------------ |
| `createSSEParser` | function | A working `SSEParserInterface`, backed by `SSEParser`. |

```ts
import { createSSEParser } from '@orkestrel/sse'

const parser = createSSEParser()
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\ndata: 1') // [] - buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping' }]
```

### Entities

| API         | Kind  | Summary                                                                                             |
| ----------- | ----- | --------------------------------------------------------------------------------------------------- |
| `SSEParser` | class | The stateful SSE stream parser — implements `SSEParserInterface`, reassembles events across chunks. |

## Methods

The public methods of `SSEParserInterface` — the class's full method surface
(AGENTS §22).

#### `SSEParserInterface`

| Method  | Returns               | Behavior                                                                                                                                               |
| ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parse` | `readonly SSEEvent[]` | Append `chunk`, then return every event a blank line has dispatched so far; a trailing partial line / in-progress event is buffered for the next call. |
| `reset` | `void`                | Drop any buffered partial line and in-progress event — reset for a fresh stream.                                                                       |

```ts
import { SSEParser } from '@orkestrel/sse'

const parser = new SSEParser()
parser.parse('data: a\ndata: b\n\n') // [{ data: 'a\nb' }] - the two data lines joined
parser.parse('event: ping\ndata: 1') // [] - the event is buffered until its blank line
parser.parse('\n\n') // [{ data: '1', event: 'ping' }]
parser.reset() // drop any buffered partial line / event - ready for a fresh stream
parser.parse('data: fresh\n\n') // [{ data: 'fresh' }]
```
