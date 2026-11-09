import {contextSchema} from './evidence-schema'
import {rawValidationContext} from './validation-identity'

export {actualHead, repositoryRoot} from './validation-identity'

/** Schema validation is separate so setup-failure capture needs no installed dependencies. */
export function validationContext() {
  return contextSchema.parse(rawValidationContext())
}
