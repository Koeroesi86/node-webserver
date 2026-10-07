# Load tests

[k6](https://k6.io) scenarios against the example server, run on every pull request by the `Load test` workflow.

## Run locally

```sh
pnpm install && pnpm build
# optional, serves https://secure.localhost too, so the HTTPS and secure websocket routes can be tested
mkdir -p packages/node-webserver/.certificates/localhost
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=secure.localhost" -addext "subjectAltName=DNS:secure.localhost" \
  -keyout packages/node-webserver/.certificates/localhost/privkey.pem -out packages/node-webserver/.certificates/localhost/cert.pem

pnpm --filter @koeroesi86/node-webserver start:load-test &   # http on 8080, https on 8443, no access logs
k6 run -e HTTPS_PORT=8443 packages/node-webserver/load-tests/example.js
```

The server also serves `lambda.localhost`, a `lambda` server running `examples/exampleLambda.js` in lambda processes, which the `lambda` route uses,
and `upload.localhost`, where `examples/upload/exampleWorker.js` reads the request body as a stream (`streamRequestBody`) and answers with its size and sha256, which the `upload` route checks.

## CPU bound worker

`cpu.js` sends requests at a fixed rate to `examples/cpu/exampleWorker.js`, a worker that hashes in a loop, about 9 ms of a core per request. The rate is higher than one worker can follow
(about 110 requests per second), so the run only passes when the requests are spread over several workers. Run it on its own, as other traffic takes the cores that the workers need:
`WORKERS_PER_PATH=1` on the server fails it, with latencies of seconds and dropped requests.

```sh
k6 run packages/node-webserver/load-tests/cpu.js
```

## Options

| Where | Name | Default | |
| --- | --- | --- | --- |
| server | `PORT_HTTP`, `PORT_HTTPS` | 8080, 8443 | ports of the server |
| server | `WORKERS_PER_PATH` | CPU cores | workers started per path, 1 reproduces the single worker bottleneck |
| k6 | `BASE_URL` | `http://localhost:8080` | |
| k6 | `HTTPS_PORT` | not set | enables the HTTPS and secure websocket routes |
| k6 | `VUS`, `WS_VUS`, `DURATION` | 20, 10, 30s | HTTP and websocket virtual users, duration |
| k6 | `MIN_REQUEST_RATE` | 1000 | requests per second the whole run has to reach |
| k6 (`cpu.js`) | `CPU_RATE`, `MAX_P95_MS` | 150, 50 | requests per second for the CPU bound worker, and the p95 allowed |

## Thresholds

They were calibrated on the 4 core GitHub runners of public repositories (see the notes in `example.js`) and are about twice the worst
value seen there. Private repositories run on 2 cores, and a different core count or user count needs different values.
The workflow scales the throughput floor with the core count of the runner.

`summary.js` turns the k6 summary export into the job summary of the workflow.
