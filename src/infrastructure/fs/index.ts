export {ConfinementError, createConfinement} from './confinement'
export type {AppliedMutation} from './mutations'
// safeResolve is legacy lexical validation only; new protected I/O uses createConfinement.
export {applyMutations, PathTraversalError, safeResolve} from './mutations'
export {collectFiles, readDiskContents, readFileContent} from './reader'
export {rollbackMutations} from './rollback'
export {scanForAssistants} from './scanner'
export type {FsService} from './types'
