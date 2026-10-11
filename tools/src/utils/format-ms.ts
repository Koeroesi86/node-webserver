export const formatMs = (value: number | undefined) => (value === undefined ? 'n/a' : `${value.toFixed(1)} ms`);
