"use client";

import type { CSSProperties } from "react";

import "@/components/dotmatrix-loader.css";

export type MatrixPattern = "diamond" | "full" | "outline" | "rose" | "cross" | "rings";
export type DotShape = "circle" | "square" | "diamond" | "hearts";
export type DotMatrixPhase = "idle" | "collapse" | "hoverRipple" | "loadingRipple";
export type DotMatrixColorPreset =
  | "solid-theme"
  | "solid-mint"
  | "grad-sunset"
  | "grad-ocean"
  | "grad-neon"
  | "grad-aurora"
  | "grad-fire"
  | "grad-prism";

const DOT_MATRIX_COLOR_PRESETS: Record<DotMatrixColorPreset, { fill: string; glow: string }> = {
  "solid-theme": { fill: "var(--color-dot-on, currentColor)", glow: "var(--color-dot-on, currentColor)" },
  "solid-mint": { fill: "#34d399", glow: "#34d399" },
  "grad-sunset": {
    fill: "linear-gradient(135deg, #ff5f6d 0%, #ffc371 52%, #ffe29a 100%)",
    glow: "#ff8b73",
  },
  "grad-ocean": {
    fill: "linear-gradient(140deg, #00c6ff 0%, #0072ff 48%, #4facfe 100%)",
    glow: "#2f8fff",
  },
  "grad-neon": {
    fill: "linear-gradient(145deg, #b4ff39 0%, #39ffb6 46%, #00d4ff 100%)",
    glow: "#59ffc8",
  },
  "grad-aurora": {
    fill: "linear-gradient(145deg, #ff3cac 0%, #784ba0 45%, #2b86c5 100%)",
    glow: "#9c64bf",
  },
  "grad-fire": {
    fill: "linear-gradient(145deg, #ff512f 0%, #dd2476 45%, #ffb347 100%)",
    glow: "#f96a5f",
  },
  "grad-prism": {
    fill: "linear-gradient(145deg, #12c2e9 0%, #c471ed 45%, #f64f59 100%)",
    glow: "#9e7de8",
  },
};

export interface DotMatrixCommonProps {
  size?: number;
  dotSize?: number;
  color?: string;
  colorPreset?: DotMatrixColorPreset;
  speed?: number;
  ariaLabel?: string;
  className?: string;
  pattern?: MatrixPattern;
  muted?: boolean;
  bloom?: boolean;
  halo?: number;
  animated?: boolean;
  hoverAnimated?: boolean;
  dotClassName?: string;
  dotShape?: DotShape;
  opacityBase?: number;
  opacityMid?: number;
  opacityPeak?: number;
  cellPadding?: number;
  boxSize?: number;
  minSize?: number;
}

export interface DotAnimationContext {
  index: number;
  row: number;
  col: number;
  phase: DotMatrixPhase;
  isActive: boolean;
  reducedMotion: boolean;
}

export interface DotAnimationState {
  className?: string;
  style?: CSSProperties;
}

export type DotAnimationResolver = (ctx: DotAnimationContext) => DotAnimationState;

export const MATRIX_SIZE = 5;
const RANGE = Array.from({ length: MATRIX_SIZE }, (_, index) => index);
const FULL_INDEXES = RANGE.flatMap((row) => RANGE.map((col) => row * MATRIX_SIZE + col));
const CENTER = Math.floor(MATRIX_SIZE / 2);

const PATTERN_INDEXES: Record<MatrixPattern, number[]> = {
  full: FULL_INDEXES,
  diamond: FULL_INDEXES.filter((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    return Math.abs(row - CENTER) + Math.abs(col - CENTER) <= 2;
  }),
  outline: FULL_INDEXES.filter((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    return row === 0 || row === MATRIX_SIZE - 1 || col === 0 || col === MATRIX_SIZE - 1;
  }),
  cross: FULL_INDEXES.filter((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    return row === CENTER || col === CENTER;
  }),
  rings: FULL_INDEXES.filter((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    const radius = Math.hypot(row - CENTER, col - CENTER);
    return Math.round(radius) === 1 || Math.round(radius) === 2;
  }),
  rose: FULL_INDEXES.filter((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    const dx = col - CENTER;
    const dy = row - CENTER;
    const angle = Math.atan2(dy, dx);
    const radius = Math.hypot(dx, dy);
    return Math.abs(Math.sin(3 * angle)) > 0.6 && radius >= 1;
  }),
};

function cx(...values: Array<string | undefined | null | false>): string {
  return values.filter(Boolean).join(" ");
}

function getPatternIndexes(pattern: MatrixPattern = "diamond"): number[] {
  return PATTERN_INDEXES[pattern];
}

function resolveDmxColorTokens(color: string, colorPreset?: DotMatrixColorPreset) {
  if (!colorPreset) return { resolvedColor: color, dotFill: color };
  const preset = DOT_MATRIX_COLOR_PRESETS[colorPreset];
  return preset ? { resolvedColor: preset.glow, dotFill: preset.fill } : { resolvedColor: color, dotFill: color };
}

function getMatrix5Layout(size: number, dotSize: number, cellPadding?: number) {
  if (cellPadding != null) {
    const gap = Math.max(0, cellPadding);
    return { gap, matrixSpan: dotSize * MATRIX_SIZE + gap * (MATRIX_SIZE - 1) };
  }
  return {
    gap: Math.max(1, Math.floor((size - dotSize * MATRIX_SIZE) / (MATRIX_SIZE - 1))),
    matrixSpan: size,
  };
}

export interface DotMatrixBaseProps extends DotMatrixCommonProps {
  phase: DotMatrixPhase;
  reducedMotion?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  animationResolver?: DotAnimationResolver;
}

export function DotMatrixBase({
  size = 24,
  dotSize = 3,
  color = "currentColor",
  colorPreset,
  speed = 1,
  ariaLabel = "Loading",
  className,
  pattern = "diamond",
  dotShape = "circle",
  muted = false,
  dotClassName,
  phase,
  reducedMotion = false,
  onMouseEnter,
  onMouseLeave,
  animationResolver,
  cellPadding,
  boxSize,
  minSize,
}: DotMatrixBaseProps) {
  const patternIndexes = new Set(getPatternIndexes(pattern));
  const { gap, matrixSpan } = getMatrix5Layout(size, dotSize, cellPadding);
  const { resolvedColor, dotFill } = resolveDmxColorTokens(color, colorPreset);
  const outerDim = boxSize && boxSize > 0 ? Math.max(boxSize, minSize ?? 0) : undefined;
  const scale = outerDim && matrixSpan > 0 ? outerDim / matrixSpan : 1;

  const rootStyle = {
    width: matrixSpan,
    height: matrixSpan,
    "--dmx-speed": speed > 0 ? 1 / speed : 1,
    "--dmx-dot-size": `${dotSize}px`,
    "--dmx-dot-fill": dotFill,
    color: resolvedColor,
    ...(outerDim
      ? { transform: `scale(${scale})`, transformOrigin: "center center" as const }
      : { minWidth: minSize, minHeight: minSize }),
  } as unknown as CSSProperties;

  const dots = FULL_INDEXES.map((index) => {
    const row = Math.floor(index / MATRIX_SIZE);
    const col = index % MATRIX_SIZE;
    const isActive = patternIndexes.has(index);
    const animationState = animationResolver?.({
      index,
      row,
      col,
      phase,
      isActive,
      reducedMotion,
    }) ?? {};

    return (
      <span
        key={index}
        aria-hidden="true"
        className={cx("dmx-dot", !isActive && "dmx-inactive", dotClassName, animationState.className)}
        style={{
          width: dotSize,
          height: dotSize,
          ...animationState.style,
          ...(!isActive ? { opacity: 0, visibility: "hidden", animation: "none" } : {}),
        }}
      />
    );
  });

  const matrix = (
    <div
      className={cx("dmx-root", `dmx-dot-shape-${dotShape}`, muted && "dmx-muted", !outerDim && className)}
      style={rootStyle}
    >
      <div className="dmx-grid" style={{ gap }}>{dots}</div>
    </div>
  );

  if (outerDim) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: outerDim,
          height: outerDim,
          minWidth: minSize,
          minHeight: minSize,
          overflow: "hidden",
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {matrix}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {matrix}
    </div>
  );
}
