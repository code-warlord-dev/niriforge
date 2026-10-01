/**
 * Motion preview service.
 *
 * This is an editor concern, not a domain one. niri stores four numbers for a
 * spring and four for a bezier; how long the motion looks like, where it peaks
 * and how it settles is something this module computes on demand so the page can
 * show it. Nothing here is persisted, and nothing here talks to the compositor:
 * a preview is a local CSS animation and nothing else.
 */

/** The bezier niri persists, as the four control-point coordinates. */
export interface BezierPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The spring niri persists. `damping` is a ratio, not a coefficient. */
export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
  epsilon: number;
}

/**
 * The config shape of a motion node: every field optional and nullable, because
 * that is how it arrives from the wire and a partial value has to be printable
 * as well as editable.
 */
type Nullable<T> = Partial<{ [K in keyof T]: T[K] | null }>;

/** Which of the two motion models a slot is being edited with. */
export type MotionModel = "spring" | "easing";

export interface MotionSample {
  /** Milliseconds since the motion started. */
  t: number;
  /** Progress from 0 to 1. */
  value: number;
}

/** Steps of the integrator, and the cap that keeps a stiff spring finite. */
const RK4_STEP_MS = 4;
const MAX_SIMULATION_MS = 4000;

export const DEFAULT_SPRING: SpringParams = {
  stiffness: 800,
  damping: 0.85,
  mass: 1,
  epsilon: 0.0001,
};

export const DEFAULT_BEZIER: BezierPoints = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };

/**
 * Clamp into the range niri accepts for a spring, so a half-typed number in the
 * editor cannot make the integrator diverge.
 */
export function clampSpring(params?: Nullable<SpringParams> | null): SpringParams {
  return {
    stiffness: clamp(params?.stiffness ?? DEFAULT_SPRING.stiffness, 1, 5000),
    damping: clamp(params?.damping ?? DEFAULT_SPRING.damping, 0.05, 3),
    mass: clamp(params?.mass ?? DEFAULT_SPRING.mass, 0.05, 10),
    epsilon: clamp(params?.epsilon ?? DEFAULT_SPRING.epsilon, 0.00001, 0.1),
  };
}

/** Clamp control points into the box a bezier curve can be drawn in. */
export function clampBezier(points?: Nullable<BezierPoints> | null): BezierPoints {
  return {
    x1: clamp(points?.x1 ?? DEFAULT_BEZIER.x1, 0, 1),
    y1: clamp(points?.y1 ?? DEFAULT_BEZIER.y1, -1, 2),
    x2: clamp(points?.x2 ?? DEFAULT_BEZIER.x2, 0, 1),
    y2: clamp(points?.y2 ?? DEFAULT_BEZIER.y2, -1, 2),
  };
}

function clamp(value: number | null | undefined, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Solve a 1-D cubic bezier for y at a given x.
 *
 * The parameter t is not the x coordinate, so x has to be inverted first. A
 * short Newton pass does it for well-behaved curves; the bisection is what
 * keeps it correct when the curve is flat enough that the derivative vanishes.
 */
export function bezierValue(points: BezierPoints, x: number): number {
  const target = clamp(x, 0, 1);
  let t = target;

  for (let i = 0; i < 8; i += 1) {
    const current = bezierAxis(points, 1, t);
    const slope = bezierSlope(points, 1, t);
    if (Math.abs(slope) < 1e-6) break;
    t -= (current - target) / slope;
    if (t < 0 || t > 1) {
      t = clamp(t, 0, 1);
      break;
    }
  }

  return bezierAxis(points, 2, t);
}

/** One axis of the curve: the 3t²−2t³ blend between the two control values. */
function bezierAxis(points: BezierPoints, axis: 1 | 2, t: number): number {
  const first = axis === 1 ? points.x1 : points.y1;
  const second = axis === 1 ? points.x2 : points.y2;
  const c0 = 0;
  const c1 = first;
  const c2 = 3 * second - 3 * first;
  const c3 = 1 + 3 * first - 3 * second;
  return ((c3 * t + c2) * t + c1) * t + c0;
}

function bezierSlope(points: BezierPoints, axis: 1 | 2, t: number): number {
  const first = axis === 1 ? points.x1 : points.y1;
  const second = axis === 1 ? points.x2 : points.y2;
  const c1 = 3 * first;
  const c2 = 6 * (second - first);
  const c3 = 3 * (1 + 3 * first - 3 * second);
  return c1 + c2 * t + c3 * t * t;
}

/** `cubic-bezier(...)` text, the same form CSS and niri's KDL both accept. */
export function bezierToCss(points: BezierPoints): string {
  return `cubic-bezier(${points.x1}, ${points.y1}, ${points.x2}, ${points.y2})`;
}

/**
 * Integrate a damped spring from rest to rest with RK4.
 *
 * The solver stops once the displacement stays inside `epsilon` for a whole
 * step, so the samples end where niri would consider the motion finished rather
 * than at a fixed horizon.
 */
export function springSamples(params: SpringParams, maxMs = 1500): MotionSample[] {
  const spring = clampSpring(params);
  const tolerance = spring.epsilon;

  let position = 0;
  let velocity = 0;

  const acceleration = (p: number, v: number): number =>
    (-spring.stiffness * p - 2 * Math.PI * 2 * spring.damping * v) / spring.mass;

  const samples: MotionSample[] = [{ t: 0, value: 0 }];
  const dt = RK4_STEP_MS / 1000;
  const limit = Math.min(maxMs, MAX_SIMULATION_MS);

  for (let t = 0; t < limit; t += RK4_STEP_MS) {
    const v1 = velocity;
    const a1 = acceleration(position, v1);
    const v2 = v1 + (a1 * dt) / 2;
    const a2 = acceleration(position + (v1 * dt) / 2, v2);
    const v3 = v1 + (a2 * dt) / 2;
    const a3 = acceleration(position + (v2 * dt) / 2, v3);
    const v4 = v1 + a3 * dt;
    const a4 = acceleration(position + (v3 * dt), v4);

    velocity = v1 + (dt * (a1 + 2 * a2 + 2 * a3 + a4)) / 6;
    position += (dt * (v1 + 2 * v2 + 2 * v3 + v4)) / 6;

    samples.push({ t: t + RK4_STEP_MS, value: position });

    if (t > RK4_STEP_MS && Math.abs(position) < tolerance && Math.abs(velocity) < tolerance) {
      break;
    }
  }

  return samples;
}

/** When the spring came to rest, which is what the page shows as settle time. */
export function springSettleMs(params: SpringParams): number | null {
  const samples = springSamples(params);
  const last = samples[samples.length - 1];
  return last && last.t > RK4_STEP_MS ? last.t : null;
}

/** The largest overshoot past 1.0, as a fraction of the travel. */
export function springOvershoot(samples: MotionSample[]): number {
  let peak = 0;
  for (const sample of samples) {
    if (sample.value > peak) peak = sample.value;
  }
  return peak > 1 ? peak - 1 : 0;
}

/** Samples for whichever model is selected, on a normalised 0..1 time base. */
export function motionSamples(
  model: MotionModel,
  params: { spring?: SpringParams; bezier?: BezierPoints },
  steps = 96
): MotionSample[] {
  if (model === "spring") {
    const raw = springSamples(params.spring ?? DEFAULT_SPRING);
    const end = raw[raw.length - 1]?.t ?? 1;
    return resample(raw, end, steps);
  }
  const points = params.bezier ?? DEFAULT_BEZIER;
  const out: MotionSample[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = i / steps;
    out.push({ t: x * 1000, value: bezierValue(points, x) });
  }
  return out;
}

function resample(samples: MotionSample[], durationMs: number, steps: number): MotionSample[] {
  if (durationMs <= 0) return samples;
  const out: MotionSample[] = [];
  let cursor = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = (durationMs * i) / steps;
    while (cursor < samples.length - 1 && samples[cursor + 1].t < t) cursor += 1;
    const a = samples[cursor];
    const b = samples[Math.min(cursor + 1, samples.length - 1)];
    const span = b.t - a.t;
    const ratio = span === 0 ? 0 : (t - a.t) / span;
    out.push({ t, value: a.value + (b.value - a.value) * ratio });
  }
  return out;
}

/**
 * The CSS timing function that best represents the given motion.
 *
 * A spring has no single timing function, so it is baked into a `linear()` easing
 * built from the integrated samples. Browsers without `linear()` fall back to the
 * plain duration rather than dropping the transition.
 */
export function motionToCss(
  model: MotionModel,
  params: { spring?: SpringParams; bezier?: BezierPoints },
  slowdown = 1
): { transition: string; durationMs: number } {
  const factor = clamp(slowdown, 0.1, 10);

  if (model === "easing") {
    const points = params.bezier ?? DEFAULT_BEZIER;
    return {
      transition: `${BEZIER_BASE_MS * factor}ms ${bezierToCss(points)}`,
      durationMs: BEZIER_BASE_MS * factor,
    };
  }

  const spring = clampSpring(params.spring ?? DEFAULT_SPRING);
  const settle = springSettleMs(spring) ?? BEZIER_BASE_MS;
  const durationMs = settle * factor;
  const baked = linearEasing(motionSamples("spring", { spring }));
  return {
    transition: `${durationMs}ms ${baked}`,
    durationMs,
  };
}

/** The travel the preview animates, before slowdown is applied. */
const BEZIER_BASE_MS = 250;

function linearEasing(samples: MotionSample[]): string {
  if (samples.length < 2) return "linear";
  const stops = samples
    .filter((_, index) => index % Math.max(1, Math.floor(samples.length / 24)) === 0)
    .map((sample) => sample.value.toFixed(4));
  const last = samples[samples.length - 1].value.toFixed(4);
  if (stops[stops.length - 1] !== last) stops.push(last);
  return `linear(${stops.join(", ")})`;
}

/**
 * Motion presets.
 *
 * These are editor starting points: choosing one fills the slot with numbers
 * niri accepts, and nothing is written until the config is saved.
 */
export interface MotionPreset {
  id: string;
  label: string;
  model: MotionModel;
  spring?: SpringParams;
  bezier?: BezierPoints;
}

export const MOTION_PRESETS: MotionPreset[] = [
  { id: "smooth", label: "Smooth", model: "easing", bezier: DEFAULT_BEZIER },
  {
    id: "snappy",
    label: "Snappy",
    model: "spring",
    spring: { stiffness: 1100, damping: 0.88, mass: 1, epsilon: 0.0001 },
  },
  {
    id: "gentle",
    label: "Gentle",
    model: "spring",
    spring: { stiffness: 600, damping: 0.95, mass: 1, epsilon: 0.0001 },
  },
  { id: "linear", label: "Linear", model: "easing", bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } },
];

/** How a motion reads, as a word rather than a number. */
export function describeDamping(ratio: number): "underdamped" | "critical" | "overdamped" {
  if (ratio < 1) return "underdamped";
  if (ratio > 1) return "overdamped";
  return "critical";
}