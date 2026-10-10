import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A server that answers with its side and the rate that the fake k6 reports for it, and a k6 that asks the server and writes a summary,
// so that the comparison can run without the real ones. The server writes its pid and the requests it got next to the checkout.
const fakeServer = `
const http = require('http');
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const checkout = join(__dirname, '../../../..');
writeFileSync(join(checkout, 'server.pid'), String(process.pid));
http.createServer((request, response) => {
  appendFileSync(join(checkout, 'requests.log'), [request.headers.host, request.method, request.url].join(' ') + '\\n');
  request.resume();
  // routes that this side does not have, one per line in missing.txt
  const missing = existsSync(join(checkout, 'missing.txt')) ? readFileSync(join(checkout, 'missing.txt'), 'utf8').split('\\n') : [];
  if (missing.includes(request.url)) response.statusCode = 404;
  response.end(readFileSync(join(checkout, 'side.txt'), 'utf8'));
}).listen(Number(process.env.PORT_HTTP));
process.on('SIGTERM', () => process.exit(0));
`;

// FAKE_K6_LOG: where the runs are logged, FAKE_K6_FAIL: no summary, FAKE_K6_SLEEP: never finishes, and tells when it started in FAKE_K6_STARTED and with its pid in FAKE_K6_PID
const fakeK6 = `#!/usr/bin/env node
const http = require('http');
const { appendFileSync, existsSync, writeFileSync } = require('fs');
const args = process.argv.slice(2);
const exportPath = args.find((argument) => argument.startsWith('--summary-export=')).split('=')[1];
const env = Object.fromEntries(args.flatMap((argument, index) => (argument === '-e' ? [args[index + 1].split(/=(.*)/s).slice(0, 2)] : [])));
const script = args[args.length - 1];
const kind = script.endsWith('cpu.ts') ? 'cpu' : script.endsWith('binary.ts') ? 'binary' : 'main';
if (!existsSync(script) || process.env.FAKE_K6_FAIL) process.exit(3);
if (process.env.FAKE_K6_SLEEP) {
  writeFileSync(process.env.FAKE_K6_PID, String(process.pid));
  writeFileSync(process.env.FAKE_K6_STARTED, '');
  setInterval(() => undefined, 1000);
} else {
  http.get(env.BASE_URL, { headers: { Host: 'web.localhost' } }, (response) => {
    let body = '';
    response.on('data', (chunk) => (body += chunk));
    response.on('end', () => {
      const [side, rate] = body.trim().split(' ');
      appendFileSync(process.env.FAKE_K6_LOG, [side, kind, env.DURATION, process.env.PREFIXED].join(' ') + '\\n');
      const metrics = kind === 'main' ? { http_reqs: { rate: Number(rate) } } : { ['http_req_duration{route:' + kind + '}']: { 'p(95)': 12 } };
      writeFileSync(exportPath, JSON.stringify({ metrics }));
    });
  });
}
`;

/** puts a fake k6 in a folder, which has to be in the PATH of what runs it */
export const installFakeK6 = (folder: string) => {
  const bin = join(folder, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'k6'), fakeK6);
  chmodSync(join(bin, 'k6'), 0o755);

  return bin;
};

/**
 * What to put in front of `k6` to run the fake. Windows does not start a script by its name, as it has no shebang and the file has no extension, so it is run by node there.
 * The command that follows is `k6 run ...`, which the fake ignores along with the other arguments it does not know.
 */
export const fakeK6Prefix = (bin: string): string[] => (process.platform === 'win32' ? [process.execPath, join(bin, 'k6')] : []);

/** a checkout with the server of the load test and the k6 scripts, that reports the rate of its side */
export const createCheckout = (folder: string, side: string, rate: number) => {
  const directory = join(folder, `${side}-${rate}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(directory, 'packages/node-webserver/dist/scripts'), { recursive: true });
  writeFileSync(join(directory, 'packages/node-webserver/dist/scripts/load-test-server.js'), fakeServer);
  writeFileSync(join(directory, 'side.txt'), `${side} ${rate}`);
  mkdirSync(join(directory, 'tools/src/k6'), { recursive: true });
  ['example.ts', 'cpu.ts', 'binary.ts'].forEach((name) => writeFileSync(join(directory, 'tools/src/k6', name), ''));

  return directory;
};
