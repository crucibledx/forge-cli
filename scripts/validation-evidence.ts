/** Dependency-free path authority, also used when frozen installation fails. */
export const checkEvidencePath = (lane: string, check: string) => `checks/${lane}/${check.replaceAll(':', '-')}.log`
