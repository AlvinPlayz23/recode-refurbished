import type { CSSProperties } from "react";

import "@/components/dotmatrix-loader.css";
import type { DotMatrixCommonProps } from "./dotmatrix-core";

export type DotmSquare18Props = DotMatrixCommonProps;

const MATRIX_SIZE = 5;
const FULL_INDEXES = Array.from({ length: MATRIX_SIZE * MATRIX_SIZE }, (_, index) => index);

function indexToCoord(index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / MATRIX_SIZE),
    col: index % MATRIX_SIZE,
  };
}

export function DotmSquare18({
  size = 20,
  dotSize = 3,
  color = "currentColor",
  speed = 1,
  ariaLabel = "Loading",
  className,
  animated = true,
  cellPadding,
}: DotmSquare18Props) {
  const gap = cellPadding ?? Math.max(1, Math.floor((size - dotSize * MATRIX_SIZE) / (MATRIX_SIZE - 1)));
  const cycleMs = Math.max(400, 1350 / Math.max(0.1, speed));

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(${MATRIX_SIZE}, ${dotSize}px)`,
        gridTemplateRows: `repeat(${MATRIX_SIZE}, ${dotSize}px)`,
        gap,
        width: dotSize * MATRIX_SIZE + gap * (MATRIX_SIZE - 1),
        height: dotSize * MATRIX_SIZE + gap * (MATRIX_SIZE - 1),
        color,
      }}
    >
      {FULL_INDEXES.map((index) => {
        const { row, col } = indexToCoord(index);
        return (
          <span
            key={index}
            aria-hidden="true"
            className={animated ? "dmx-square18-visible-dot" : undefined}
            style={{
              width: dotSize,
              height: dotSize,
              borderRadius: 999,
              background: "currentColor",
              opacity: animated ? undefined : 0.65,
              animationDuration: `${cycleMs}ms`,
              animationDelay: `${-(col * 120 + row * 32)}ms`,
            } as CSSProperties}
          />
        );
      })}
    </span>
  );
}
