import './claude-code'
import './cline'
import './copilot'
import './cursor'
import './windsurf'

export {harnessesRegistry, getAllHarnesses, getHarness, getHarnessIds, resolveHarnessByPath} from './registry'
export type {
  HarnessConfig,
  HarnessDefinition,
  HarnessId,
  DetectionResult,
  DetectionRule,
  TargetMapping,
} from './types'
