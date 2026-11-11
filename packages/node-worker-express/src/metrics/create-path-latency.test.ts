import createPathLatency from './create-path-latency';

describe('createPathLatency', () => {
  it('keeps a histogram per path', () => {
    const latency = createPathLatency(10);

    latency.get('/a.js').record(3);
    latency.get('/a.js').record(4);
    latency.get('/b.js').record(30);

    const result = latency.read();
    expect(result['/a.js'].count).toBe(2);
    expect(result['/b.js'].count).toBe(1);
  });

  it('counts the paths above the limit together, so that many different paths cannot grow it', () => {
    const latency = createPathLatency(2);

    Array.from({ length: 1000 }, (_, index) => `/${index}.js`).forEach((path) => latency.get(path).record(1));

    const result = latency.read();
    expect(Object.keys(result)).toEqual(['/0.js', '/1.js', '(other)']);
    expect(result['(other)'].count).toBe(998);
  });

  it('still counts a path it knows when the limit is reached', () => {
    const latency = createPathLatency(1);

    latency.get('/a.js').record(1);
    latency.get('/b.js').record(1);
    latency.get('/a.js').record(1);

    expect(latency.read()['/a.js'].count).toBe(2);
  });

  it('leaves out the shared histogram while nothing is counted in it', () => {
    const latency = createPathLatency(1);

    latency.get('/a.js').record(1);

    expect(latency.read()).not.toHaveProperty('(other)');
  });
});
