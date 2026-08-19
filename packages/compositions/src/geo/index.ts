import worldLand from './world-land.json'

/**
 * Real land geometry for map slots, bundled into the repo — no tiles, no
 * network, no API key (decision 126). Both consumers draw from this one
 * module so the board's `MapPreview` and the `AnimatedMap` composition can
 * never disagree about where the coastline is:
 *
 * - the web app imports `@boom-busters/compositions/geo` (this file has no
 *   React or Remotion imports, so nothing video-related enters the bundle);
 * - `AnimatedMap` imports it relatively.
 *
 * Source: Natural Earth 1:110m, `ne_110m_land` (public domain / CC0,
 * naturalearthdata.com), coordinates rounded to 0.01° (~1.1 km — invisible
 * at documentary zoom levels) and consecutive duplicates dropped: 127
 * polygons, ~75 KB. The projection is equirectangular — a plate carrée over
 * the viewing window — because map slots say "the money moved from HERE to
 * THERE", not "navigate by this".
 */

export interface GeoPoint {
  lat: number
  lon: number
}

/** A viewing window in degrees. West < east, south < north, always. */
export interface GeoBounds {
  west: number
  east: number
  south: number
  north: number
}

interface WorldLand {
  /** polygon → rings (first outer, rest holes) → [lon, lat] points. */
  polygons: number[][][][]
}

const LAND: WorldLand = worldLand as WorldLand

/** Per-polygon bounding boxes, computed once — cheap visibility culling. */
const POLYGON_BOUNDS: GeoBounds[] = LAND.polygons.map((rings) => {
  let west = 180
  let east = -180
  let south = 90
  let north = -90
  for (const ring of rings) {
    for (const point of ring) {
      const lon = point[0]!
      const lat = point[1]!
      if (lon < west) west = lon
      if (lon > east) east = lon
      if (lat < south) south = lat
      if (lat > north) north = lat
    }
  }
  return { west, east, south, north }
})

/**
 * The viewing window around a set of locations: their bounding box, padded,
 * and never so tight that a single city becomes a featureless void. The
 * exact maths the visual board has used since M5 — extracted, not changed.
 */
export function fitBounds(points: readonly GeoPoint[]): GeoBounds {
  const lats = points.map((point) => point.lat)
  const lons = points.map((point) => point.lon)
  const padLon = Math.max(8, (Math.max(...lons) - Math.min(...lons)) * 0.25)
  const padLat = Math.max(5, (Math.max(...lats) - Math.min(...lats)) * 0.25)
  return {
    west: Math.max(-180, Math.min(...lons) - padLon),
    east: Math.min(180, Math.max(...lons) + padLon),
    south: Math.max(-90, Math.min(...lats) - padLat),
    north: Math.min(90, Math.max(...lats) + padLat),
  }
}

/** Expand (factor > 1) or tighten a window around its centre, world-clamped. */
export function scaleBounds(bounds: GeoBounds, factor: number): GeoBounds {
  const centreLon = (bounds.west + bounds.east) / 2
  const centreLat = (bounds.south + bounds.north) / 2
  const halfLon = ((bounds.east - bounds.west) / 2) * factor
  const halfLat = ((bounds.north - bounds.south) / 2) * factor
  return {
    west: Math.max(-180, centreLon - halfLon),
    east: Math.min(180, centreLon + halfLon),
    south: Math.max(-90, centreLat - halfLat),
    north: Math.min(90, centreLat + halfLat),
  }
}

/** Linear blend between two windows — the map camera's flight path. */
export function interpolateBounds(from: GeoBounds, to: GeoBounds, t: number): GeoBounds {
  const lerp = (a: number, b: number) => a + (b - a) * t
  return {
    west: lerp(from.west, to.west),
    east: lerp(from.east, to.east),
    south: lerp(from.south, to.south),
    north: lerp(from.north, to.north),
  }
}

/** Degrees → pixels for a window rendered at width × height. */
export function projector(
  bounds: GeoBounds,
  width: number,
  height: number,
): { x: (lon: number) => number; y: (lat: number) => number } {
  return {
    x: (lon) => ((lon - bounds.west) / (bounds.east - bounds.west)) * width,
    y: (lat) => ((bounds.north - lat) / (bounds.north - bounds.south)) * height,
  }
}

/**
 * Graticule line positions at a spacing that yields a handful of lines, not
 * a grid — also extracted verbatim from the board's MapPreview.
 */
export function graticule(bounds: GeoBounds): { lons: number[]; lats: number[] } {
  const lonStep = Math.ceil((bounds.east - bounds.west) / 6 / 5) * 5 || 5
  const latStep = Math.ceil((bounds.north - bounds.south) / 4 / 5) * 5 || 5
  const lons: number[] = []
  for (let lon = Math.ceil(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep)
    lons.push(lon)
  const lats: number[] = []
  for (let lat = Math.ceil(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep)
    lats.push(lat)
  return { lons, lats }
}

function boundsIntersect(a: GeoBounds, b: GeoBounds): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south
}

/** Even-odd ray cast: is the point inside the polygon (holes respected)? */
function pointInPolygon(rings: number[][][], lon: number, lat: number): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const xi = ring[i]![0]!
      const yi = ring[i]![1]!
      const xj = ring[j]![0]!
      const yj = ring[j]![1]!
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
  }
  return inside
}

/**
 * Should this polygon be drawn for this window? The bounding box says maybe;
 * bounding boxes of continent-sized polygons cover oceans they do not touch
 * (the Americas' box blankets most of the Pacific), so confirm with either a
 * vertex inside the window or the window's centre inside the polygon — the
 * latter catches a window entirely surrounded by land, which has no coast
 * vertices to find.
 */
function polygonVisible(rings: number[][][], bounds: GeoBounds): boolean {
  for (const ring of rings) {
    for (const point of ring) {
      const lon = point[0]!
      const lat = point[1]!
      if (lon >= bounds.west && lon <= bounds.east && lat >= bounds.south && lat <= bounds.north) {
        return true
      }
    }
  }
  return pointInPolygon(rings, (bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2)
}

/**
 * SVG path data for every land polygon visible in the window, projected to
 * width × height. One path per polygon, rings concatenated — render with
 * `fillRule="evenodd"` so lakes (the Caspian) stay water. Coordinates round
 * to 0.1 px to keep the DOM light; overflow past the edges is expected and
 * clipped by the SVG viewBox.
 */
export function landPaths(bounds: GeoBounds, width: number, height: number): string[] {
  const { x, y } = projector(bounds, width, height)
  const paths: string[] = []
  LAND.polygons.forEach((rings, index) => {
    if (!boundsIntersect(POLYGON_BOUNDS[index]!, bounds)) return
    if (!polygonVisible(rings, bounds)) return
    let d = ''
    for (const ring of rings) {
      ring.forEach((point, pointIndex) => {
        const px = Math.round(x(point[0]!) * 10) / 10
        const py = Math.round(y(point[1]!) * 10) / 10
        d += `${pointIndex === 0 ? 'M' : 'L'}${px} ${py}`
      })
      d += 'Z'
    }
    paths.push(d)
  })
  return paths
}
