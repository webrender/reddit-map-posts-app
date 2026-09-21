export type Point = {x: number; y: number}

export type SpreadOptions = {
  /** The nearest two centres may come; anything closer is pushed apart. */
  minDistance: number
  /** The frame the centres must stay inside. */
  width: number
  height: number
  /** How close to the frame's edge a centre may sit. */
  margin: number
  /**
   * Fixed spots the markers must keep clear of and cannot move — a Region's
   * label, say, laid out as a row of points. A marker is pushed away from each
   * by `obstacleDistance`, which is not `minDistance`: it is a marker's radius
   * plus the obstacle's own, where `minDistance` is two marker radii.
   */
  obstacles?: readonly Point[]
  obstacleDistance?: number
}

/** Slack in a distance comparison, so a pair exactly `minDistance` apart is not pushed forever. */
const tolerance = 0.01
const relaxPasses = 300
/** The golden angle, which spreads coincident points into a spiral rather than a line. */
const goldenAngle = 2.399963

/**
 * Moves points apart until no two centres are closer than `minDistance`, keeping
 * each as near where it began as it can — for markers that would otherwise sit
 * on top of one another. Returns new points in the same order and never mutates
 * the input.
 *
 * It first pushes overlapping pairs apart, half each, which keeps a cluster
 * roughly where it was and fans it out. That usually settles, but it is not
 * guaranteed to before running out of passes, so a second step walks the points
 * in order and moves any that still collide to the nearest free spot on a
 * widening spiral. If the frame simply has no room left the point stays put:
 * there is no answer to give, and dropping a marker would be worse.
 */
export function spreadPoints(
  points: readonly Point[],
  options: SpreadOptions,
): Point[] {
  const placed = points.map(point => clamp(point, options))
  const {minDistance} = options
  const tooClose = (a: Point, b: Point) => tooCloseTo(a, b, minDistance)
  const obstacles = options.obstacles ?? []
  const obstacleDistance = options.obstacleDistance ?? minDistance

  for (let pass = 0; pass < relaxPasses; pass++) {
    let moved = false
    for (let i = 0; i < placed.length; i++) {
      for (const obstacle of obstacles) {
        const a = placed[i] as Point
        if (!tooCloseTo(a, obstacle, obstacleDistance)) continue
        let dx = a.x - obstacle.x
        let dy = a.y - obstacle.y
        let distance = Math.hypot(dx, dy)
        if (distance < 1e-6) {
          dx = Math.cos(i * goldenAngle)
          dy = Math.sin(i * goldenAngle)
          distance = 1
        }
        const push = obstacleDistance - distance
        placed[i] = clamp(
          {x: a.x + (dx / distance) * push, y: a.y + (dy / distance) * push},
          options,
        )
        moved = true
      }
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i] as Point
        const b = placed[j] as Point
        if (!tooClose(a, b)) continue
        let dx = b.x - a.x
        let dy = b.y - a.y
        let distance = Math.hypot(dx, dy)
        if (distance < 1e-6) {
          // On top of each other there is no direction to push in, so pick one
          // that differs by index.
          dx = Math.cos(i * goldenAngle)
          dy = Math.sin(i * goldenAngle)
          distance = 1
        }
        const push = (minDistance - distance) / 2
        placed[i] = clamp(
          {x: a.x - (dx / distance) * push, y: a.y - (dy / distance) * push},
          options,
        )
        placed[j] = clamp(
          {x: b.x + (dx / distance) * push, y: b.y + (dy / distance) * push},
          options,
        )
        moved = true
      }
    }
    if (!moved) break
  }

  for (let i = 0; i < placed.length; i++) {
    const here = placed[i] as Point
    const settled = placed.slice(0, i)
    const blocked = (point: Point) =>
      obstacles.some(o => tooCloseTo(point, o, obstacleDistance))
    if (!blocked(here) && !settled.some(other => tooClose(here, other))) {
      continue
    }
    const free = nearestFree(here, settled, options, blocked)
    if (free) placed[i] = free
  }
  return placed
}

/** The closest spot to `from`, on rings of growing radius, that is clear of `others`. */
function nearestFree(
  from: Point,
  others: readonly Point[],
  options: SpreadOptions,
  blocked: (point: Point) => boolean,
): Point | undefined {
  const {minDistance} = options
  const step = minDistance / 2
  const reach = Math.hypot(options.width, options.height)
  for (let radius = step; radius <= reach; radius += step) {
    const around = Math.max(8, Math.ceil((2 * Math.PI * radius) / step))
    for (let n = 0; n < around; n++) {
      const angle = (n / around) * 2 * Math.PI
      const candidate = {
        x: from.x + Math.cos(angle) * radius,
        y: from.y + Math.sin(angle) * radius,
      }
      if (!inside(candidate, options) || blocked(candidate)) continue
      if (others.every(other => !tooCloseTo(candidate, other, minDistance))) {
        return candidate
      }
    }
  }
  return undefined
}

function tooCloseTo(a: Point, b: Point, minDistance: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < minDistance - tolerance
}

function inside(point: Point, {width, height, margin}: SpreadOptions): boolean {
  return (
    point.x >= margin &&
    point.x <= width - margin &&
    point.y >= margin &&
    point.y <= height - margin
  )
}

function clamp(point: Point, {width, height, margin}: SpreadOptions): Point {
  return {
    x: Math.min(Math.max(point.x, margin), width - margin),
    y: Math.min(Math.max(point.y, margin), height - margin),
  }
}
