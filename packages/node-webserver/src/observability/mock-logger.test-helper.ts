import type { Logger, LogLevels } from '../types';

/** a logger that records its calls, with every level enabled */
const createMockLogger = (): jest.Mocked<Logger> => ({
  system: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  flush: jest.fn(),
  isEnabled: jest.fn((_level: keyof LogLevels) => true),
});

export default createMockLogger;
