import path from 'path';
import getModuleFiles from './get-module-files';

const create = (filename: string, children: NodeJS.Module[] = []) => ({ filename: path.resolve(filename), children }) as unknown as NodeJS.Module;

describe('getModuleFiles', () => {
  it('is the file of the module and the ones it loaded, each once', () => {
    const shared = create('shared.js');
    const module = create('a.js', [create('b.js', [shared]), shared]);

    expect(Array.from(getModuleFiles(module))).toEqual(['a.js', 'b.js', 'shared.js'].map((file) => path.resolve(file)));
  });

  it('leaves the packages out, with what they load', () => {
    const module = create('a.js', [create(path.join('node_modules', 'package.js'), [create('behind.js')])]);

    expect(Array.from(getModuleFiles(module))).toEqual([path.resolve('a.js')]);
  });
});
