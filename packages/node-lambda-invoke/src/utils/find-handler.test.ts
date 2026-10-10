import findHandler from './find-handler';

describe('findHandler', () => {
  it('finds an export of a module', () => {
    const handler = () => 1;

    expect(findHandler({ handler }, 'handler')?.handler).toBe(handler);
  });

  it('finds a nested handler and calls it on what holds it', () => {
    const controllers = { users: { get() {} } };

    const found = findHandler({ controllers }, 'controllers.users.get');

    expect(found?.handler).toBe(controllers.users.get);
    expect(found?.thisArg).toBe(controllers.users);
  });

  it('looks into the default export, where an ES module has a CommonJS module', () => {
    const handler = () => 1;

    expect(findHandler({ default: { handler } }, 'handler')?.handler).toBe(handler);
  });

  it('prefers a named export to the default one', () => {
    const named = () => 1;

    expect(findHandler({ handler: named, default: { handler: () => 2 } }, 'handler')?.handler).toBe(named);
  });

  it('finds nothing for a name that is missing or not a function', () => {
    expect(findHandler({ handler: 'text' }, 'handler')).toBeUndefined();
    expect(findHandler({}, 'a.b.c')).toBeUndefined();
    expect(findHandler(undefined, 'handler')).toBeUndefined();
  });
});
