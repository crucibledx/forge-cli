import {afterEach} from 'bun:test'

import {disposeActiveProcesses} from './process'

afterEach(disposeActiveProcesses)
