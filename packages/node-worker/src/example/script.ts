import { clearLine, cursorTo } from 'readline';

let t: NodeJS.Timeout;
const writeLine = () => {
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0, null);

  process.stdout.write(`Current time: ${new Date().toLocaleTimeString()}`);
  t = setTimeout(writeLine, 1000);
};
writeLine();

process.stdin.setEncoding('utf8');
process.stdin.setRawMode(true);

process.stdin.on('data', (data) => {
  if (['\r', '\u0003', 'q'].includes(data.toString())) {
    clearTimeout(t);
    console.log('\nThanks for trying.');
    process.exit();
  }
});
