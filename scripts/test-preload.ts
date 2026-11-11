import {createTestSandbox} from './test-sandbox'

// Native backend setup is tool setup, not a per-test hook. Resolve it before test imports.
// Under run-tests.ts this reuses the launcher's compiled template, which outlives this bootstrap
// sandbox; command environments get independent copies.
if (process.platform === 'win32') {
  const sandbox = createTestSandbox('forge-test-bootstrap-')
  try {
    void sandbox.env
  } finally {
    sandbox.dispose()
  }
}
