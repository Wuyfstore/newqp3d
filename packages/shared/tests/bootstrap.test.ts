import { describe, expect, it } from 'vitest'
import { sharedPackageName } from '../src/index.js'

describe('shared workspace bootstrap', () => {
  it('exports the shared package name', () => {
    expect(sharedPackageName).toBe('@new-qp3d/shared')
  })
})
