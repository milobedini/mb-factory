// The team's T-shirt sizes, and the estimates Linear stores for them.
export const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;

export type Size = (typeof SIZES)[number];

export const ESTIMATES: Record<Size, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
