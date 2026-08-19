import { describe, expect, it } from 'vitest'
import { fitBounds, graticule, interpolateBounds, landPaths, projector, scaleBounds } from './index'
import worldLand from './world-land.json'

describe('world geometry data', () => {
  const polygons = (worldLand as { polygons: number[][][][] }).polygons

  it('carries the full Natural Earth 110m land set', () => {
    expect(polygons.length).toBeGreaterThan(100)
  })

  it('keeps every coordinate on the globe and every ring drawable', () => {
    for (const rings of polygons) {
      for (const ring of rings) {
        expect(ring.length).toBeGreaterThanOrEqual(4)
        for (const point of ring) {
          expect(point[0]).toBeGreaterThanOrEqual(-180)
          expect(point[0]).toBeLessThanOrEqual(180)
          expect(point[1]).toBeGreaterThanOrEqual(-90)
          expect(point[1]).toBeLessThanOrEqual(90)
        }
      }
    }
  })

  it('has at least one polygon with a hole, rendered via evenodd', () => {
    // Eurasia's Caspian Sea — the reason landPaths concatenates rings.
    expect(polygons.some((rings) => rings.length > 1)).toBe(true)
  })
})

describe('fitBounds', () => {
  it('pads a single city into a window, never a featureless void', () => {
    const bounds = fitBounds([{ lat: 51.5, lon: -0.12 }])
    expect(bounds.east - bounds.west).toBeCloseTo(16)
    expect(bounds.north - bounds.south).toBeCloseTo(10)
  })

  it('clamps to the world at the edges', () => {
    const bounds = fitBounds([{ lat: 89, lon: 179 }])
    expect(bounds.east).toBe(180)
    expect(bounds.north).toBe(90)
  })
})

describe('projector', () => {
  it('maps the window corners to the frame corners', () => {
    const bounds = { west: -10, east: 10, south: -5, north: 5 }
    const { x, y } = projector(bounds, 200, 100)
    expect(x(-10)).toBe(0)
    expect(x(10)).toBe(200)
    expect(y(5)).toBe(0)
    expect(y(-5)).toBe(100)
  })
})

describe('camera maths', () => {
  it('scaleBounds expands around the centre', () => {
    const bounds = { west: -10, east: 10, south: -5, north: 5 }
    const wider = scaleBounds(bounds, 2)
    expect(wider).toEqual({ west: -20, east: 20, south: -10, north: 10 })
  })

  it('interpolateBounds is the identity at its ends', () => {
    const a = { west: -20, east: 20, south: -10, north: 10 }
    const b = { west: -10, east: 10, south: -5, north: 5 }
    expect(interpolateBounds(a, b, 0)).toEqual(a)
    expect(interpolateBounds(a, b, 1)).toEqual(b)
    expect(interpolateBounds(a, b, 0.5)).toEqual({ west: -15, east: 15, south: -7.5, north: 7.5 })
  })
})

describe('landPaths', () => {
  it('finds coastline around Britain', () => {
    const bounds = fitBounds([{ lat: 51.5, lon: -0.12 }])
    const paths = landPaths(bounds, 640, 360)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0]).toMatch(/^M-?[\d.]+ -?[\d.]+L/)
  })

  it('returns nothing for open ocean', () => {
    // The South Pacific between Chile and the islands: all water at 110m.
    const bounds = { west: -130, east: -120, south: -50, north: -40 }
    expect(landPaths(bounds, 640, 360)).toEqual([])
  })

  it('keeps a window entirely surrounded by land — no coast vertex needed', () => {
    // Central Kansas: no coastline for a thousand kilometres, but the
    // Americas polygon must still be drawn or the map would be all sea.
    const bounds = { west: -100, east: -96, south: 37, north: 40 }
    expect(landPaths(bounds, 640, 360).length).toBeGreaterThan(0)
  })

  it('culls by polygon bounding box — a Europe window excludes the Americas', () => {
    const europe = fitBounds([
      { lat: 51.5, lon: -0.12 },
      { lat: 48.9, lon: 2.35 },
    ])
    const world = { west: -180, east: 180, south: -90, north: 90 }
    expect(landPaths(europe, 640, 360).length).toBeLessThan(landPaths(world, 640, 360).length)
  })
})

describe('graticule', () => {
  it('yields a handful of lines, not a grid', () => {
    const bounds = fitBounds([{ lat: 51.5, lon: -0.12 }])
    const { lons, lats } = graticule(bounds)
    expect(lons.length).toBeGreaterThan(0)
    expect(lons.length).toBeLessThanOrEqual(8)
    expect(lats.length).toBeGreaterThan(0)
    expect(lats.length).toBeLessThanOrEqual(6)
  })
})
