export interface ExactDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

export function parseExactDecimal(value: string): ExactDecimal {
  const [integer, fraction = ''] = value.split('.');
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function alignedCoefficient(value: ExactDecimal, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

export function addExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: alignedCoefficient(left, scale) + alignedCoefficient(right, scale),
    scale,
  };
}

export function subtractExactDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient: alignedCoefficient(left, scale) - alignedCoefficient(right, scale),
    scale,
  };
}

export function compareExactDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const difference = subtractExactDecimals(left, right).coefficient;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function formatExactDecimal(value: ExactDecimal): string {
  const negative = value.coefficient < 0n;
  const raw = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, '0');
  if (value.scale === 0) return `${negative ? '-' : ''}${raw}`;
  const integer = raw.slice(0, -value.scale);
  const fraction = raw.slice(-value.scale).replace(/0+$/, '');
  const magnitude = fraction.length === 0 ? integer : `${integer}.${fraction}`;
  return `${negative ? '-' : ''}${magnitude}`;
}
