/** the path the way the file system knows it, or undefined for a malformed escape (`%zz`, a lone `%` or invalid UTF-8) */
const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

export default decodePath;
