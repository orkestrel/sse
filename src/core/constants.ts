/**
 * The NUL byte (`U+0000`). The SSE spec voids an `id:` field whose value contains
 * it, so an `id` carrying a NUL is never surfaced. Spelled as a codepoint so the
 * wire content is unambiguous in source.
 */
export const NUL = String.fromCharCode(0)

/**
 * The byte-order mark (`U+FEFF`), stripped from the very first chunk of an SSE
 * stream (a leading BOM on later chunks is ordinary content). Spelled as a
 * codepoint so the wire content is unambiguous in source.
 */
export const BOM = String.fromCharCode(0xfeff)
