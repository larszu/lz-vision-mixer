import { describe, expect, it } from 'vitest'
import { EASE_DIRECTIONS, EASE_FAMILIES, ease } from '../src/easing'

describe('ease', () => {
  for (const family of EASE_FAMILIES)
    for (const direction of EASE_DIRECTIONS)
      it(`${family} ${direction} starts at 0 and ends at 1`, () => {
        expect(ease({ family, direction }, 0)).toBeCloseTo(0, 6)
        expect(ease({ family, direction }, 1)).toBeCloseTo(1, 6)
      })

  it('inOut is symmetric around the midpoint', () => {
    for (const family of EASE_FAMILIES) expect(ease({ family, direction: 'inOut' }, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('out mirrors in', () => {
    const e = (direction: 'in' | 'out', t: number) => ease({ family: 'cubic', direction }, t)
    expect(e('out', 0.3)).toBeCloseTo(1 - e('in', 0.7), 9)
  })

  it('clamps progress outside 0..1', () => {
    expect(ease({ family: 'quad', direction: 'in' }, -1)).toBe(0)
    expect(ease({ family: 'quad', direction: 'in' }, 2)).toBe(1)
  })

  it('back overshoots below 0 when easing in', () => {
    expect(ease({ family: 'back', direction: 'in' }, 0.2)).toBeLessThan(0)
  })
})
