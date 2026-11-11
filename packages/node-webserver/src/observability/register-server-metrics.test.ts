import { createLambdaStats } from '@koeroesi86/node-lambda-invoke';
import { createWorkerBudget, getServerMetrics } from '@koeroesi86/node-worker-express';
import registerServerMetrics from './register-server-metrics';

describe('registerServerMetrics', () => {
  const sources = () => Object.keys(getServerMetrics().sources);

  it('registers the workers and the lambdas and unregisters both', () => {
    const unregister = registerServerMetrics(createWorkerBudget(1).getStats, createLambdaStats());
    const during = sources();
    unregister();

    expect(during).toEqual(expect.arrayContaining(['workers', 'lambdas']));
    expect(sources()).not.toContain('workers');
    expect(sources()).not.toContain('lambdas');
  });

  it('can be unregistered twice without harm', () => {
    const unregister = registerServerMetrics(createWorkerBudget(1).getStats, createLambdaStats());
    unregister();

    expect(unregister).not.toThrow();
  });
});
