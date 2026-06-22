import { describe, expect, it } from 'vitest'
import { normalizeMaterial } from '../src/normalize/material.js'

describe('normalizeMaterial', () => {
  it.each([
    ['砼', '混凝土'],
    ['混凝土管', '混凝土'],
    ['UPVC管', 'UPVC'],
    ['  PE管  ', 'PE管'],
    [null, '未知'],
    ['', '未知'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeMaterial(raw)).toBe(expected)
  })

  it('normalizes aliases with internal whitespace', () => {
    expect(normalizeMaterial('UPVC 管')).toBe('UPVC')
  })
})
