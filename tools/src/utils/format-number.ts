/** a value that went through a JSON file may be `null` (what `Infinity` or `NaN` become), which is as unknown as `undefined` */
export const formatNumber = (value: number | undefined, digits = 0) => (Number.isFinite(value) ? Number(value).toFixed(digits) : 'n/a');
