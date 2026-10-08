import { getRegisteredPath, isRegistered } from './index';

describe('registry', () => {
  it('knows the ipc and the file communication', () => {
    expect(isRegistered('ipc')).toBe(true);
    expect(isRegistered('file')).toBe(true);
  });

  it('does not know anything else', () => {
    expect(isRegistered('smoke-signals')).toBe(false);
  });

  it('gives the path of the storage of a communication type', () => {
    expect(getRegisteredPath('ipc')).toBe('../classes/IPCStorage');
    expect(getRegisteredPath('file')).toBe('../classes/FileStorage');
  });

  it('throws for an unknown or missing type', () => {
    expect(() => getRegisteredPath('smoke-signals')).toThrow('Unknown communication type: smoke-signals');
    expect(() => getRegisteredPath(undefined)).toThrow('Unknown communication type: undefined');
  });
});
