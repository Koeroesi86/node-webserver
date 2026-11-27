import labelLine from './label-line';

describe('labelLine', () => {
  it('puts the time and the host name in front of the text, keeping its indentation', () => {
    expect(labelLine('app.localhost', '    at app.js:1')).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{2}\] \[app\.localhost\]     at app\.js:1$/);
  });
});
