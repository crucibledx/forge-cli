import {createTestSandbox} from './test-sandbox'

// Native backend setup is tool setup, not a per-test hook. Resolve it before test
// imports (normally the launcher's compiled template); command environments get independent copies.
if (process.platform === 'win32') {
  const sandbox = createTestSandbox('forge-test-bootstrap-')
  try {
    void sandbox.env
  } finally {
    sandbox.dispose()
  }
}
