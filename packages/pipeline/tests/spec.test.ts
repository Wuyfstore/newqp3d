import { describe, expect, it } from 'vitest'
import { parsePipeSpec } from '../src/normalize/spec.js'

describe('parsePipeSpec', () => {
  it.each([
    ['300', { kind: 'round', diameterMm: 300, source: '300', quality: 'parsed' }],
    [' DN600 ', { kind: 'round', diameterMm: 600, source: ' DN600 ', quality: 'parsed' }],
    ['200X200', { kind: 'box', widthMm: 200, heightMm: 200, source: '200X200', quality: 'parsed' }],
    ['700×450', { kind: 'box', widthMm: 700, heightMm: 450, source: '700×450', quality: 'parsed' }],
  ])('parses %s', (raw, expected) => {
    expect(parsePipeSpec(raw)).toEqual(expected)
  })

  it.each([null, '', '0', '缺失', '其他'])('defaults invalid spec %s', raw => {
    expect(parsePipeSpec(raw)).toEqual({
      kind: 'round',
      diameterMm: 300,
      source: raw ?? '',
      quality: 'defaulted',
    })
  })
})
