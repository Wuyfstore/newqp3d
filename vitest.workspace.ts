import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/shared',
  'packages/pipeline',
  'apps/api',
  'apps/web',
])
