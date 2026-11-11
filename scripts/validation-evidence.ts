/** Dependency-free evidence limits and paths. */
export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
export const checkEvidencePath = (lane: string, check: string) => `checks/${lane}/${check.replaceAll(':', '-')}.log`
