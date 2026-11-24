// Small dense linear algebra for the radar's ridge fits (Node 22 stdlib only).
// Everything here is deterministic: plain float arithmetic, no randomness, no dates.
// Gaussian elimination with partial pivoting for solves, Gauss-Jordan for inverses.

export type Matrix = number[][];

/** An n-by-n zero matrix. */
export function zeros(n: number): Matrix {
  const out: Matrix = [];
  for (let i = 0; i < n; i++) out.push(new Array<number>(n).fill(0));
  return out;
}

/** X transpose times X, for an n-by-p X. */
export function xtx(x: Matrix): Matrix {
  const n = x.length;
  const p = x[0]!.length;
  const out = zeros(p);
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += x[k]![i]! * x[k]![j]!;
      out[i]![j] = s;
      out[j]![i] = s;
    }
  }
  return out;
}

/** X transpose times y, for an n-by-p X and length-n y. */
export function xty(x: Matrix, y: number[]): number[] {
  const n = x.length;
  const p = x[0]!.length;
  const out = new Array<number>(p).fill(0);
  for (let i = 0; i < p; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += x[k]![i]! * y[k]!;
    out[i] = s;
  }
  return out;
}

/**
 * Solve A b = rhs for a square A, by Gaussian elimination with partial pivoting.
 * A and rhs are not mutated. Throws when A is singular to working precision.
 */
export function solve(a: Matrix, rhs: number[]): number[] {
  const n = a.length;
  const m: Matrix = a.map((row) => [...row]);
  const b = [...rhs];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) throw new Error('singular matrix in solve');
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
      const tb = b[col]!;
      b[col] = b[piv]!;
      b[piv] = tb;
    }
    const diag = m[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / diag;
      if (f === 0) continue;
      for (let c = col; c < n; c++) m[r]![c]! -= f * m[col]![c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= m[i]![j]! * out[j]!;
    out[i] = s / m[i]![i]!;
  }
  return out;
}

/**
 * Invert a square matrix by Gauss-Jordan with partial pivoting.
 * The input is not mutated. Throws when the matrix is singular to working precision.
 */
export function invert(a: Matrix): Matrix {
  const n = a.length;
  const m: Matrix = a.map((row, i) => [...row, ...new Array<number>(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) throw new Error('singular matrix in invert');
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    const diag = m[col]![col]!;
    for (let c = 0; c < 2 * n; c++) m[col]![c]! /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]!;
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row) => row.slice(n));
}

/** The dot product of two equal-length vectors. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** A matrix-vector product. */
export function matVec(a: Matrix, v: number[]): number[] {
  return a.map((row) => dot(row, v));
}

/** The median of a non-empty array (the mean of the two middles for even lengths). */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n % 2 === 1) return s[(n - 1) / 2]!;
  return (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
