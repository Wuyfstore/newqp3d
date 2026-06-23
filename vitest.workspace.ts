import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/runtime-config',
  'packages/shared',
  'packages/pipeline',
  'apps/api',
  'apps/web',
])
