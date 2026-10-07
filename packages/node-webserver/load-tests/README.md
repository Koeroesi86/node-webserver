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
and `upload.localhost`, where `examples/upload/exampleWorker.js` reads the request body as a stream and answers with its size and sha256, which the `upload` route checks,
and `health.localhost`, whose worker answers `/health` and `/metrics` from the metrics the server gives to workers, which the `metrics` route checks.

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

## Cores

The workflow gives the server and k6 cores of their own (`taskset`), so that they do not take cores from each other and the results depend less on how the runner schedules them: k6 gets one core in four (at least one),
the server the rest, which is 3 and 1 on the 4 core runners of public repositories. The pools of the server size themselves after the cores it may use, and the throughput floor is 250 requests per second for each of its cores.
Two cores for the server were not enough for the lambda route (a p95 of 140-160 ms), k6 uses about 70% of its core. To try the same locally, on a machine with 4 cores:

```sh
taskset -c 0-2 pnpm --filter @koeroesi86/node-webserver start:load-test &
taskset -c 3 k6 run -e HTTPS_PORT=8443 packages/node-webserver/load-tests/example.js
```

## Comparison with the base

The absolute thresholds catch a collapse, not a slowdown, and the machines of shared runners differ too much from run to run to compare numbers of different runs: the same code has run at 3,300 and 4,600 requests per second.
So on a pull request the workflow also builds the base (the commit it is merged into) next to the pull request, and measures both **in the same job**, one at a time, alternating, three runs of 15 seconds each (`compare.sh`).
Both sides run the load test of the pull request against their own server, so that the load is the same. Then `compare.js` takes the median of the runs of each side and shows the change in the job summary:

- **throughput** is judged: a pull request with more than 15% less requests per second than the base fails (`MAX_THROUGHPUT_DROP`, 0.15),
- **the p95 of a route** is judged with wide limits, 50% and 5 milliseconds higher (`MAX_P95_INCREASE` 0.5, `MIN_P95_DIFFERENCE_MS` 5). The load is a fixed number of users, so a build that is faster gets more requests through
  every route, which makes the routes compete for the cores: the p95 of one route can rise while the build is better. The limits only catch a route that got much slower,
- a route that the base cannot serve (the pull request added it, which the checks per route show) is listed with n/a and not judged,
- the p95 of all requests and the connect time of the websocket are shown, not judged.

Same code on both sides measured within 2% of each other with runs that varied by 1-2%, while 0.2 milliseconds of extra work for every request (47% less throughput) failed it. The comparison needs a load test in the base:
for the pull request that adds the load test, and while the base cannot be built, the summary says there is nothing to compare with. Locally, with checkouts of both (`git worktree add ../base master`, install and build each), and the cores split as in the workflow:

```sh
SERVER_PREFIX='taskset -c 0-2' K6_PREFIX='taskset -c 3' packages/node-webserver/load-tests/compare.sh ../base . 3 15s
```

The results are in `compare-results/`, the exit code is 1 on a regression. Each run also shows the processor of the runner and how much of the time it was held back by its host (steal time) in the job summary, which explains runs that are slow for no reason of the code.

## Thresholds

They were calibrated on the 4 core GitHub runners of public repositories (see the notes in `example.js`) and are about twice the worst
value seen there. Private repositories run on 2 cores, and a different core count or user count needs different values.
The workflow scales the throughput floor with the core count of the runner.

`summary.js` turns the k6 summary export into the job summary of the workflow.
