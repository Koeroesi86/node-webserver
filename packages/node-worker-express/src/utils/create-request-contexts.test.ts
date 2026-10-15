import createRequestContexts from './create-request-contexts';

describe('createRequestContexts', () => {
  it('opens one context per request and hands the same one back', () => {
    const contexts = createRequestContexts();

    expect(contexts.get('a')).toBeUndefined();
    expect(contexts.open('a')).toBe(contexts.open('a'));
    expect(contexts.get('a')).toBe(contexts.open('a'));
    expect(contexts.open('b')).not.toBe(contexts.open('a'));
  });

  it('keeps a context while something is left in it', () => {
    const contexts = createRequestContexts();
    contexts.open('a').stream = { waiting: [], aborted: false };
    contexts.open('a').metricsWaiting.push(jest.fn());

    contexts.change('a', (context) => {
      context.stream = undefined;
    });

    expect(contexts.size).toBe(1);
  });

  it('drops a context once a change leaves it empty', () => {
    const contexts = createRequestContexts();
    contexts.open('a').stream = { waiting: [], aborted: false };

    contexts.change('a', (context) => {
      context.stream = undefined;
    });

    expect(contexts.size).toBe(0);
  });

  it('ignores a change of a request that has no context, and does not create one', () => {
    const contexts = createRequestContexts();
    const mutate = jest.fn();

    contexts.change('a', mutate);

    expect(mutate).not.toHaveBeenCalled();
    expect(contexts.size).toBe(0);
  });
});
