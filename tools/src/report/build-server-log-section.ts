import { existsSync, readFileSync } from 'node:fs';

/** the lines of the log of the server that are errors, undefined when there is no log */
const readServerErrors = (serverLogPath: string | undefined) =>
  serverLogPath && existsSync(serverLogPath)
    ? readFileSync(serverLogPath, 'utf8')
        .split('\n')
        .filter((line) => /\b(Error|TypeError|500 Internal Server Error)\b/.test(line))
    : undefined;

/** the log of the server is only looked at when there is one */
export const buildServerLogSection = (serverLogPath: string | undefined) => {
  const serverErrors = readServerErrors(serverLogPath);
  if (serverErrors === undefined) return [];
  if (serverErrors.length === 0) return ['### Server log\n\nNo errors logged.'];

  return [`### Server log\n\n${serverErrors.length} error line(s), first ones:\n\n\`\`\`\n${serverErrors.slice(0, 5).join('\n')}\n\`\`\``];
};
