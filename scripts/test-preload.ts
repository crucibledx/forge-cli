import {createTestSandbox} from './test-sandbox'

// Native compilation is tool setup, not a per-test hook. Prime the process-local
// immutable bytes before test imports; command environments get independent copies.
if (process.platform === 'win32') {
  const sandbox = createTestSandbox('forge-test-bootstrap-')
  try {
    void sandbox.env
  } finally {
    sandbox.dispose()
  }
}
