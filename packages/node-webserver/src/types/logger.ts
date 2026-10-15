export interface LogLevels {
  system?: boolean;
  info?: boolean;
  success?: boolean;
  error?: boolean;
  warning?: boolean;
}

export type LogFunction = (...args: unknown[]) => void;

export interface Logger extends Record<keyof LogLevels, LogFunction> {
  /** writes everything that waits, also when nothing does */
  flush: () => void;
  /** whether lines of the level are logged, to spare building the ones that would be dropped */
  isEnabled: (level: keyof LogLevels) => boolean;
}
