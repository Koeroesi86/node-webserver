import path from 'path';
import type { NormalizedStaticOptions } from './normalize-static-options';

export const defaultCacheControl = 'public, max-age=0';

/** The `Cache-Control` value of the first rule that matches the request path, the default when none does. */
const findCacheControl = (rules: NormalizedStaticOptions['cacheControl'], requestPath: string) => {
  const extension = path.extname(requestPath).toLowerCase();

  return (
    rules.find((rule) => (rule.folder === undefined || requestPath.startsWith(rule.folder)) && (rule.extension === undefined || rule.extension === extension))
      ?.value ?? defaultCacheControl
  );
};

export default findCacheControl;
