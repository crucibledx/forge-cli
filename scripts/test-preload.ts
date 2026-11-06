import {createTestSandbox} from './test-sandbox'

// Native compilation is tool setup, not a per-test hook. Prime the process-local
// immutable bytes before test imports; each fixture still gets its own binary.
if (process.platform === 'win32') createTestSandbox('forge-test-bootstrap-').dispose()
