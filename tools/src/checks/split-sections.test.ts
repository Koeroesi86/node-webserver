import { splitSections } from './split-sections';

describe('splitSections', () => {
  it('maps every heading to the text under it', () => {
    expect([...splitSections('intro\n## One\n\na\n\n## Two\nb\n')]).toEqual([
      ['One', '\na\n\n'],
      ['Two', 'b\n'],
    ]);
  });

  it('has no sections without a heading', () => {
    expect(splitSections('text').size).toBe(0);
  });
});
