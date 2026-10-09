// a test that fails is run again up to two more times before it counts as failed, as some depend on the speed of the runner (processes that start, sockets)
jest.retryTimes(2, { logErrorsBeforeRetry: true });
