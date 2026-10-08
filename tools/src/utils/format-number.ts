export const formatNumber = (value: number | undefined, digits = 0) => (value === undefined ? 'n/a' : value.toFixed(digits));
