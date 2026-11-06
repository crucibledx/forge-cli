export {ConfinementError, createConfinement} from './confinement'
// safeResolve is legacy lexical validation only; new protected I/O uses createConfinement.
export {PathTraversalError, safeResolve} from './mutations'
export {collectFiles, readDiskContents} from './reader'
export {scanForAssistants} from './scanner'
