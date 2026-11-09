export const PRODUCER_ROLES = {CODE: 'code', SECURITY: 'security', VERIFIER: 'verifier'} as const
export type ProducerRole = (typeof PRODUCER_ROLES)[keyof typeof PRODUCER_ROLES]
export const REVIEW_ROLES = [PRODUCER_ROLES.CODE, PRODUCER_ROLES.SECURITY] as const
