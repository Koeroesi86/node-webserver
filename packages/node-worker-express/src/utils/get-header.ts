/** the value of a header by its name in any case */
export default function getHeader(headers: Record<string, string> | undefined, name: string) {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
}
