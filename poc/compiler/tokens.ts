import { getEncoding } from 'js-tiktoken'

const enc = getEncoding('o200k_base')

// o200k is a proxy: Claude's tokenizer differs, so absolute numbers are calibrated against droid-measured usage.
export const countTokens = (s: string): number => (s ? enc.encode(s).length : 0)

// What a harness keeps in context for a model-invocable skill or a Task-callable droid: its routing entry.
export const indexEntry = (name: string, description: string) => `- ${name}: ${description}`
