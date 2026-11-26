import fingerprintConfiguration from './fingerprint-configuration';

describe('fingerprintConfiguration', () => {
  it('is the same for the same configuration', () => {
    const configuration = () => ({ portHttp: 80, servers: [{ options: { limitPerPath: () => 2 } }] });

    expect(fingerprintConfiguration(configuration())).toBe(fingerprintConfiguration(configuration()));
  });

  it.each([
    ['a setting', { portHttp: 81 }],
    ['a function', { limitPerPath: () => 3 }],
    ['a pattern', { pattern: /b/ }],
  ])('changes with %s', (_, change) => {
    const configuration = { portHttp: 80, limitPerPath: () => 2, pattern: /a/ };

    expect(fingerprintConfiguration({ ...configuration, ...change })).not.toBe(fingerprintConfiguration(configuration));
  });
});
