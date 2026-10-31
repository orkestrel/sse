/**
 * Names the null byte (`U+0000`). The SSE spec voids an `id:` field whose value contains it,
 * so an `id` carrying a NUL is never surfaced.
 *
 * @remarks
 * Spelled as a codepoint so the wire content is unambiguous in source.
 */
export const NUL = String.fromCharCode(0)
