# Tools

Internal tooling of the workspace (`@koeroesi86/tools`, never published). The scripts are TypeScript in `src/`, compiled to `dist/` by `pnpm build`, and their tests (jest, `*.test.ts`) run with `pnpm test` in this folder or `pnpm test` in the root.

| Tool | What it does | Run |
| --- | --- | --- |
| [Versions](#versions) | prepares the versions of the packages for publishing | `pnpm generate-version` |
| [Channel benchmark](#channel-benchmark) | the channel between the server and a worker on its own: messages and bytes per second, the old IPC against the socket pair | `node tools/dist/scripts/channel-bench.js` |
| [Load tests](#load-tests) | k6 scenarios, the comparison with the base of a pull request, the job summary | `pnpm load-test`, `node tools/dist/scripts/compare-with-base.js`, `node tools/dist/scripts/summary.js` |

### Layout

Everything is in `src/`, the tests (`*.test.ts`) are next to the code they test:

| Folder | What is in it |
| --- | --- |
| `scripts/` | the entries, one file for every command: `version.ts`, `load-test.ts`, `compare.ts`, `compare-with-base.ts`, `summary.ts`, `runner.ts`, `channel-bench.ts` (and `channel-bench-child.ts`, the process it measures against). They read the arguments and the environment and call the utils, their tests run the compiled script from `dist/scripts/` |
| `k6/` | the k6 scenarios (`example.ts`, `cpu.ts`), which k6 runs itself and which have their own `tsconfig.k6.json` (in the root of `tools`) for the k6 types. `pnpm build` type checks them |
| `utils/` | the functions the scripts are made of, one per file |
| `types/` | the interfaces shared by the scripts and the utils |
| `constants/` | the limits and defaults of the load test |
| `test-helpers/` | what several tests share (summaries to compare, a server on a free port), not compiled |

## Versions

`src/scripts/version.ts` (`pnpm generate-version` in the root, run by the publish workflow, twice a day and by hand) prepares the versions of the workspace packages for publishing.
A package is published when it has no published release yet, or when its own folder or the folder of any workspace package it depends on changed since the commit that its latest published release was created from (`gitHead`).
Such packages get a new version and their commit written to `gitHead`. All the others get the version that is already on the registry, so the `workspace:` dependencies pointing at them are rewritten to an existing release and `pnpm publish` leaves them out.

| Environment | |
| --- | --- |
| `GITHUB_RUN_ID`, `GITHUB_REF_NAME` | required, used for the new version |
| `NPM_REGISTRY_URL` | the registry to compare with, defaults to https://registry.npmjs.org |
| `VERSION_DRY_RUN` | only print the plan without changing any file |
| `PUBLISH_ALL` | publish every package regardless of the changes |

## Channel benchmark

`node tools/dist/scripts/channel-bench.js [ipc|socket|both] [scale]` (needs `pnpm build`) measures the channel between the server and a worker without HTTP, which the load test cannot do: the number does not depend on Express, the runner or k6.
A child process echoes every message, the parent keeps a number of them in flight (1 or 64, 16 and 4 for the bigger bodies) and measures messages per second, megabytes of body per second, its own CPU time per message and the latency, for requests without a body and with bodies of 4 KiB, 64 KiB and 1 MiB.
`socket` is the `createChannel` of `node-worker-express`, the socket pair that workers get as their fourth stdio. `ipc` is what it replaced in #66, the IPC of node with the JSON of a request and its body as base64. `scale` multiplies the number of messages (the default is 1, a run is about a minute).
Pin it like the load test to compare runs, for example `taskset -c 0-2 node tools/dist/scripts/channel-bench.js`; on 3 cores the socket was 2-10 times faster with a body from 4 KiB and not faster without one.

## Load tests

[k6](https://k6.io) scenarios against the example server, run on every pull request by the `Load test` workflow (a job of the branch build, after the lint, tests and build passed), on Linux, Windows and macOS. The scenarios are TypeScript that k6 runs itself (k6 1.0 or newer strips the types), the rest needs `pnpm build` first (`tools/dist`).

### Run locally

```sh
pnpm install
pnpm load-test           # builds, starts the example server, runs the example scenario and then the others, each on its own, stops the server
pnpm load-test 30s       # a longer example run (15s by default)
```

`scripts/load-test.ts` (`pnpm load-test` builds first) does what the workflow does, on one machine: it makes the certificate for `https://secure.localhost` (needs `openssl`, the HTTPS routes are left out without it),
starts the server on `PORT_HTTP` / `PORT_HTTPS` (8080 and 8443), warms it up, runs `example.ts`, `cpu.ts`, `binary.ts` and, with the certificate, `tls.ts`, and stops the server. The exit code is 1 when a threshold fails.
The k6 summary is printed, and the log of the server is in a temporary folder, whose path is printed first.

It uses **the installed k6** when there is one, and otherwise **Docker** with the official [`grafana/k6`](https://hub.docker.com/r/grafana/k6) image (the version of the workflow, `k6Image` in `constants/load-test.ts`).

#### Installing k6 (preferred)

The scenarios are TypeScript that k6 runs itself, so k6 1.0 or newer is needed (the workflow uses 1.2.2). Other systems and the release binaries: [Install k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).

| System | Install |
| --- | --- |
| macOS | `brew install k6` |
| Windows | `winget install k6 --source winget`, or `choco install k6` |
| Debian, Ubuntu | add the repository, then `sudo apt-get install k6` (below) |
| Fedora, RHEL, CentOS | `sudo dnf install https://dl.k6.io/rpm/repo.rpm`, then `sudo dnf install k6` |
| Any (Linux, macOS, Windows) | the archive of a [release](https://github.com/grafana/k6/releases), with `k6` in the `PATH` |

```sh
## Debian, Ubuntu
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Check it with `k6 version`.

#### Docker instead

With no k6 installed `pnpm load-test` runs `docker run --rm -i --network host -v tools/src/k6:/scripts:ro grafana/k6:<version> run ...` for you, so Docker is all that is needed.
The container shares the network of the host (`--network host`), so that it reaches the server on `localhost`. That works on Linux; on Docker Desktop (macOS, Windows)
it needs host networking to be enabled (Settings > Resources > Network, Docker Desktop 4.34 or newer), otherwise install k6. SELinux labels are switched off for the container (`--security-opt label=disable`), so no mount is refused on Fedora.
The container runs the scenarios on its own cores, so the numbers differ from the installed k6 a little, and an installed k6 is the one to compare with the workflow.

#### By hand

The same with the commands separate, for example to run one scenario or to pass other options (see the table below):

```sh
pnpm build
## optional, serves https://secure.localhost too, so the HTTPS and secure websocket routes can be tested
mkdir -p packages/node-webserver/.certificates/localhost
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=secure.localhost" -addext "subjectAltName=DNS:secure.localhost" \
  -keyout packages/node-webserver/.certificates/localhost/privkey.pem -out packages/node-webserver/.certificates/localhost/cert.pem

pnpm --filter @koeroesi86/node-webserver start:load-test &   # http on 8080, https on 8443, no access logs
k6 run -e HTTPS_PORT=8443 tools/src/k6/example.ts
```

The server also serves `lambda.localhost`, a `lambda` server running `examples/exampleLambda.js` in lambda processes, which the `lambda` route uses,
and `upload.localhost`, where `examples/upload/exampleWorker.js` reads the request body as a stream and answers with its size and sha256, which the `upload` route checks,
and `health.localhost`, whose worker answers `/health` and `/metrics` from the metrics the server gives to workers, which the `metrics` route checks.

### Big binary responses

`binary.ts` requests `web.localhost/binary/?size=786432` (`examples/binary/exampleWorker.js`: 768 KiB from the worker in a single message) with 10 users and checks every byte through the sha256, with a p95 of at most 100 ms. The comparison with the base runs it too, see below.
It runs on its own after the CPU bound one, and is left out of the comparison with the base: a base without the route would answer it with fast errors, and look better for it.
To see the difference to another build, give that build the route (a worker with the same name) and run the script against both servers.

### New TLS connections

`tls.ts` opens a new connection for every request (`noVUConnectionReuse`), so each request on `https://secure.localhost` is a full handshake on the front process (k6 does not resume TLS sessions), with 10 users.
Next to it 100 plain HTTP requests per second go to the worker route, and one user reads `health.localhost/metrics` every half second for how late the event loop of the server ran (`tls_server_event_loop_max_ms`).
The p95 of the plain requests and of the ones after a handshake may be at most 50 ms (`MAX_PLAIN_P95_MS`), the p95 of the handshake itself 100 ms (`MAX_HANDSHAKE_P95_MS`), and the workflow multiplies both with `P95_FACTOR`.
It runs when there is a certificate, on its own after the binary one, and is left out of the comparison with the base. Handshakes per second are the `http_reqs` of the `handshakes` scenario.

With the server on 3 cores and k6 on the fourth, three runs each (`taskset`, as in [Cores](#cores)):

| Certificate | Handshakes per second | Handshake median / p95 | Plain HTTP median / p95 |
| --- | --- | --- | --- |
| RSA 2048, 1 user instead of 10 (one run) | 410 | 1.2 ms / 1.8 ms | 1.3 ms / 2.6 ms |
| RSA 2048 (what the load test makes) | 670-720 | 8.5-9.0 ms / 12.5-13.4 ms | 5.5-5.9 ms / 8.5-9.6 ms |
| ECDSA P-256 | 970-1030 | 5.4-5.7 ms / 9.4-10.1 ms | 4.0-4.2 ms / 8.3-9.4 ms |

The handshakes take the event loop that serves every other request, so the plain requests are slower while they run, by less with an ECDSA certificate. Nothing in the cipher settings moved it either. Three runs of 10 seconds each, handshakes per second (RSA 2048 / ECDSA P-256): default 710-770 / 980-1000, `honorCipherOrder` 720-740 / 1000-1090, `TLS_AES_128_GCM_SHA256` first 760-780 / 990-1120,
`TLS_CHACHA20_POLY1305_SHA256` first 750-760 / 950-1060, `ecdhCurve: 'X25519'` instead of the default `X25519MLKEM768` 720-770 / 1020-1040. The runs of one setting differ by as much as the settings do. Only `maxVersion: 'TLSv1.2'` stood out, with 820-890 / 1110-1190.

```sh
k6 run -e HTTPS_PORT=8443 tools/src/k6/tls.ts
```

Options: `VUS`, `PLAIN_RATE`, `DURATION`, `MAX_PLAIN_P95_MS`, `MAX_HANDSHAKE_P95_MS`.

### Lambdas that fail

`lambda.ts` works the `lambda` server type where it can go wrong, against three servers of the load test configuration that run `examples/lambda-failures/exampleLambda.js` (`/ok`, `/slow?ms=`, `/crash`, `/throw`):

- **a crashing lambda** (`lambda-crash.localhost`, 1 user hits `/crash`): the request that was running on the lambda is answered with 502 and a generic body, while 2 users on the same server get 200 all the time,
- **overload** (`lambda-overload.localhost`, 8 users, 2 lambdas that need 1.5 seconds, `acquireTimeout` of half a second): every request is answered with 200 or 503, a 503 after the acquire timeout and less than `MARGIN_MS` (1000) later, none hangs (the scenario also fails when there was no 503 at all, or no 200),
- **the `file` communication** (`lambda-file.localhost`): answered like the default one.

It runs on its own after the binary one, is left out of the comparison with the base (a base without the servers answers with errors) and takes `DURATION` (10s) and `MARGIN_MS`.

```sh
k6 run tools/src/k6/lambda.ts
```

### Websocket flow control

`websocket.ts` works the flow control of websockets (`examples/websocket-flow/exampleWorker.js`, `web.localhost/websocket-flow/exampleWorker.js`) with 5 + 5 users and one that samples the memory of the server through `health.localhost/metrics`:
a **fast producer** sends 400 messages of 32 KiB (text and binary) in a burst to a worker that takes 2 ms for each, and has to get every one back, whole and in order; a **slow consumer** reads 200 messages of 64 KiB, one every 5 ms,
from a worker that sends them as fast as the client takes them, and has to get all of them in order and the close of the worker. The memory the server holds outside of the heap (where the messages wait) may not exceed 100 MiB at any time
(`ws_flow_server_external_mib`, `MAX_EXTERNAL_MIB`): it peaked at 50-70 MiB with the flow control, and at 175-195 MiB with the window towards the worker taken out. It runs on its own and is left out of the comparison with the base (`binary.ts` is compared, see below).

```sh
k6 run tools/src/k6/websocket.ts
```

Options: `PRODUCED_MESSAGES`, `WORKER_DELAY_MS`, `FLOOD_MESSAGES`, `CONSUMER_DELAY_MS`, `VUS`, `DURATION`, `MAX_EXTERNAL_MIB`.

### CPU bound worker

`cpu.ts` sends requests at a fixed rate to `examples/cpu/exampleWorker.js`, a worker that hashes in a loop, about 9 ms of a core per request. The rate is higher than one worker can follow
(about 110 requests per second), so the run only passes when the requests are spread over several workers. Run it on its own, as other traffic takes the cores that the workers need:
`WORKERS_PER_PATH=1` on the server fails it, with latencies of seconds and dropped requests.

```sh
k6 run tools/src/k6/cpu.ts
```

### Options

| Where | Name | Default | |
| --- | --- | --- | --- |
| server | `PORT_HTTP`, `PORT_HTTPS` | 8080, 8443 | ports of the server |
| server | `WORKERS_PER_PATH` | CPU cores | workers started per path, 1 reproduces the single worker bottleneck |
| server | `ACCESS_LOGS` | not set | `1` turns the access logs on (the `info` and `success` levels), to measure the logger on the path of every request |
| k6 | `BASE_URL` | `http://localhost:8080` | |
| k6 | `HTTPS_PORT` | not set | enables the HTTPS and secure websocket routes |
| k6 | `VUS`, `WS_VUS`, `DURATION` | 20, 10, 30s | HTTP and websocket virtual users, duration |
| k6 | `MIN_REQUEST_RATE` | 1000 | requests per second the whole run has to reach |
| compare | `MAX_THROUGHPUT_DROP`, `MAX_P95_INCREASE`, `MAX_CPU_P95_INCREASE`, `MIN_P95_DIFFERENCE_MS` | 0.15, 0.5, 0.3, 5 | limits of the comparison with the base |
| k6 (`cpu.ts`) | `CPU_RATE`, `MAX_P95_MS` | 150, 100 | requests per second for the CPU bound worker, and the p95 allowed |

### Cores

The workflow gives the server and k6 cores of their own (`taskset`), so that they do not take cores from each other and the results depend less on how the runner schedules them: k6 gets one core in four (at least one),
the server the rest, which is 3 and 1 on the 4 core runners of public repositories. The pools of the server size themselves after the cores it may use, and the throughput floor is 250 requests per second for each of its cores.
Two cores for the server were not enough for the lambda route (a p95 of 140-160 ms), k6 uses about 70% of its core. To try the same locally, on a machine with 4 cores:

```sh
taskset -c 0-2 pnpm --filter @koeroesi86/node-webserver start:load-test &
taskset -c 3 k6 run -e HTTPS_PORT=8443 tools/src/k6/example.ts
```

### Comparison with the base

The absolute thresholds catch a collapse, not a slowdown, and the machines of shared runners differ too much from run to run to compare numbers of different runs: the same code has run at 3,300 and 4,600 requests per second.
So on a pull request the workflow also builds the base (the commit it is merged into) next to the pull request, and measures both **in the same job**, one at a time, alternating, three runs of 15 seconds each (`scripts/compare-with-base.ts`, with the logic in `utils/compare-with-base.ts`).
Both sides run the load test of the pull request against their own server, so that the load is the same. Then `utils/compare-summaries.ts` takes the median of the runs of each side and shows the change in the job summary:

- **throughput** is judged: a pull request with more than 15% less requests per second than the base fails (`MAX_THROUGHPUT_DROP`, 0.15),
- **the p95 of a route** is judged with wide limits, 50% and 5 milliseconds higher (`MAX_P95_INCREASE` 0.5, `MIN_P95_DIFFERENCE_MS` 5). The load is a fixed number of users, so a build that is faster gets more requests through
  every route, which makes the routes compete for the cores: the p95 of one route can rise while the build is better. The limits only catch a route that got much slower,
- a route that the base cannot serve (the pull request added it, which the checks per route show) is listed with n/a and not judged, and its requests (`http_reqs{route:...}` of `example.ts`) are taken out of the throughput of both sides: the fast errors of the base would count as throughput, and the work of the pull request as a loss. The row then says so,
- the p95 of all requests and the connect time of the websocket are shown, not judged,
- **warm-up**: before the measuring of every run the server is warmed up (`utils/warm-up-server.ts`). Each endpoint in `constants/warm-up.ts` (the worker, static, CPU, stream, binary, lambda, compressed, upload and health servers) is polled until it answers with anything but a server error, which starts its worker, and then gets 20 more requests. The first seconds of a run would otherwise measure the start of the workers, which differs between versions on purpose (for example the pre-started static worker). An endpoint that does not answer in time (the base may lack a server of the pull request) is reported in the log and the run goes on. The WebSocket and the secure server are not warmed up,
- **the CPU bound run** (`cpu.ts`, 10 seconds after every run of the example load test, on the same server) is compared as well. It has a fixed arrival rate, so its latency does not depend on how fast the other routes are,
  and tighter limits hold: a p95 more than 30% and 5 milliseconds higher fails (`MAX_CPU_P95_INCREASE`, 0.3), and so does a build that drops requests where the base does not. A base without the CPU bound worker is listed with n/a and not judged.
  Its p95 is the lowest of the runs of each side, not their median: at a fixed arrival rate the machine can only slow a run down, so a slower build is slower in every run, while the median of the same server on both sides once came out 43 against 73 ms on Linux.
  The duration is the fifth argument of `compare-with-base.js`.
- **the binary run** (`binary.ts`, with 10 users, after the CPU bound run of every round; its duration, 10 seconds, is the sixth argument of `compare-with-base.js`) is compared as well: its p95 is judged like a route (50% and 5 milliseconds higher fails), a gain only shows in the row. A base without the route answers with errors, which fail the checks of the scenario, and is listed with n/a and not judged,
- **routes served by one side only**: the warm-up also records the status each side answers per endpoint. When they differ (for example a 404 on the base for a route the pull request added), the summary lists them under "Not served alike". It does not fail: a pull request may add a route, but a scenario that works a route for one side only skews the numbers, so it belongs in a script of its own (like `binary.ts`) and not in `example.ts`,
- **runs**: the third argument of `compare-with-base.js`. The workflow uses 3 on Ubuntu and 5 on macOS and Windows (`comparison-rounds`), where the same side varied by a factor of 3 between runs and the median needs more of them.

Same code on both sides measured within 2% of each other with runs that varied by 1-2%, while 0.2 milliseconds of extra work for every request (47% less throughput) failed it. The comparison needs a load test in the base:
for the pull request that adds the load test, and while the base cannot be built, the summary says there is nothing to compare with. Locally, with checkouts of both (`git worktree add ../base master`, install and build each), and the cores split as in the workflow:

```sh
SERVER_PREFIX='taskset -c 0-2' K6_PREFIX='taskset -c 3' node tools/dist/scripts/compare-with-base.js ../base . 3 15s 10s
```

`SERVER_ENV` (`NAME=value NAME=value`) is added to the environment of both servers, `MAIN_ONLY=1` leaves out the CPU bound and the binary runs, and `RESULTS_DIRECTORY` (default `compare-results`) is where the results go.
On Ubuntu the workflow runs the comparison a second time with `SERVER_ENV=ACCESS_LOGS=1 MAIN_ONLY=1` (`compare-results-access-logs/`), so that the logger shows in the numbers. It is informational, does not fail the job, and only runs when the base knows `ACCESS_LOGS`,
as a base that does not would run without access logs and the difference would not be about the logger.

The results are in `compare-results/`, the exit code is 1 on a regression. Each run also shows the processor of the runner and how much of the time it was held back by its host (steal time) in the job summary, which explains runs that are slow for no reason of the code.

### Thresholds

They were calibrated on the 4 core GitHub runners of public repositories (see the notes in `example.ts`) and are about twice the worst
value seen there. Private repositories run on 2 cores, and a different core count or user count needs different values.
The workflow scales the throughput floor with the core count of the runner.

`scripts/summary.ts` turns the k6 summary export into the job summary of the workflow, `scripts/runner.ts` describes the runner (`snapshot` before and after the test, then `report`), and `scripts/compare.ts` compares summary exports that exist already (`--base a.json b.json --head c.json d.json [--base-cpu ...] [--head-cpu ...]`). The default limits of the comparison are in `constants/comparison-limits.ts`.

### Windows and macOS

The workflow runs the same steps on the three systems (bash, also on Windows), with what differs set in its matrix, as the other systems are slower at starting processes and their runners have less to share:

- there is no `taskset`, so the server and k6 share the cores instead of having cores of their own, and the throughput floor is lower for each core (`requests-per-core`),
- the p95 of the routes is allowed to be higher (`P95_FACTOR` multiplies all of them, `P95_OVERRIDES` of `example.ts` sets some, for example the lambdas, which are processes, and the time to connect a websocket), and the CPU bound run has its own p95, rate and number of dropped requests it may have (`MAX_P95_MS`, `CPU_RATE`, `MAX_DROPPED`),
- the limits of the comparison with the base are wider (`MAX_THROUGHPUT_DROP` and the others in the table above), as the same code measured up to 40% apart there. They still catch a collapse,
- the comparison does not fail the job there (`comparison-informational`). The table and the verdict are in the job summary, and Linux is the one that decides. Eight pull requests that do not touch the request path showed why (October 2026):
  - on Windows the first run of the comparison (always the base) measured 3 to 7 times the throughput of the other nine (4,385 to 10,818 req/s against 1,250 to 2,750), in every one of them. The step that stopped the server of the single run before it ended the server only: its 53 workers and lambdas stayed. Since that step ends the whole tree (`taskkill /T`) the first run is like the others (1,479 req/s, the runs within 1,214-1,542). Each run of the comparison logs its share of failed requests and checks, its slowest route and (on Linux) the steal time, which tells such a run apart. The lambdas are the slowest route there (a p95 of 540-700 ms, against 15-40 ms on Linux and macOS, see issue #38),
  - on macOS the runs of the same side differ by up to 2.5 times (1,200 to 3,086 req/s), the medians of unchanged code moved between −18% and +18%, and the p95 of the CPU bound run by up to +57%,
  - on Linux the medians stayed within 6% and the p95 of the CPU bound run within 15%, while it is 9-14 ms on some runners and 24-37 ms on others.

On Windows a process that is killed leaves the processes it started behind, which keep the handles of the step open and the step from finishing, so `stopProcess` ends the whole tree there (`taskkill /T`), and so does the step of the workflow that stops the server before the comparison. The comparison step took about 5 minutes in every one of those runs, it has not hung again.
