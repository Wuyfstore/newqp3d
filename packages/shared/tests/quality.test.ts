import { describe, expect, it } from 'vitest'
import type { FeatureQualityFlag } from '../src/quality.js'

describe('feature quality flags', () => {
  it('accepts documented emitted pipe-network flag names exactly', () => {
    const documentedEmittedFlags: FeatureQualityFlag[] = [
      'endpoint-duplicate',
      'duplicate-candidate',
      'reverse-duplicate-candidate',
      'short-segment',
    ]

    expect(documentedEmittedFlags).toEqual([
      'endpoint-duplicate',
      'duplicate-candidate',
      'reverse-duplicate-candidate',
      'short-segment',
    ])
  })
})
