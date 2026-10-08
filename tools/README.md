# Tools

Internal tooling of the workspace (`@koeroesi86/tools`, never published). The scripts are TypeScript in `src/`, compiled to `dist/` by `pnpm build`, and their tests (jest, `*.test.ts`) run with `pnpm test` in this folder or `pnpm test` in the root.

| Tool | What it does | Run |
| --- | --- | --- |
| [Versions](#versions) | prepares the versions of the packages for publishing | `pnpm generate-version` |
| [Load tests](#load-tests) | k6 scenarios, the comparison with the base of a pull request, the job summary | `k6 run tools/src/scripts/k6/example.ts`, `node tools/dist/scripts/compare-with-base.js`, `node tools/dist/scripts/summary.js` |

### Layout

Everything is in `src/`, the tests (`*.test.ts`) are next to the code they test:

| Folder | What is in it |
| --- | --- |
| `scripts/` | the entries, one file for every command: `version.ts`, `compare.ts`, `compare-with-base.ts`, `summary.ts`, `runner.ts`. They read the arguments and the environment and call the utils, their tests run the compiled script from `dist/scripts/` |
| `scripts/k6/` | the k6 scenarios (`example.ts`, `cpu.ts`), which k6 runs itself and which have a `tsconfig.json` of their own for the k6 types. `pnpm build` type checks them |
| `utils/` | the functions the scripts are made of, one per file |
| `types/` | the interfaces shared by the scripts and the utils |
| `constants/` | the limits and defaults of the load test |
| `test-helpers/` | what several tests share (summaries to compare, a server on a free port), not compiled |

## Versions

`src/scripts/version.ts` (`pnpm generate-version` in the root, run by the publish workflow) prepares the versions of the workspace packages for publishing.
A package is published when it has no published release yet, or when its own folder or the folder of any workspace package it depends on changed since the commit that its latest published release was created from (`gitHead`).
Such packages get a new version and their commit written to `gitHead`. All the others get the version that is already on the registry, so the `workspace:` dependencies pointing at them are rewritten to an existing release and `pnpm publish` leaves them out.

| Environment | |
| --- | --- |
| `GITHUB_RUN_ID`, `GITHUB_REF_NAME` | required, used for the new version |
| `NPM_REGISTRY_URL` | the registry to compare with, defaults to https://registry.npmjs.org |
| `VERSION_DRY_RUN` | only print the plan without changing any file |
| `PUBLISH_ALL` | publish every package regardless of the changes |

## Load tests

[k6](https://k6.io) scenarios against the example server, run on every pull request by the `Load test` workflow. The scenarios are TypeScript that k6 runs itself (k6 1.0 or newer strips the types), the rest needs `pnpm build` first (`tools/dist`).

### Run locally

```sh
pnpm install && pnpm build
## optional, serves https://secure.localhost too, so the HTTPS and secure websocket routes can be tested
mkdir -p packages/node-webserver/.certificates/localhost
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=secure.localhost" -addext "subjectAltName=DNS:secure.localhost" \
  -keyout packages/node-webserver/.certificates/localhost/privkey.pem -out packages/node-webserver/.certificates/localhost/cert.pem

pnpm --filter @koeroesi86/node-webserver start:load-test &   # http on 8080, https on 8443, no access logs
k6 run -e HTTPS_PORT=8443 tools/src/scripts/k6/example.ts
```

The server also serves `lambda.localhost`, a `lambda` server running `examples/exampleLambda.js` in lambda processes, which the `lambda` route uses,
and `upload.localhost`, where `examples/upload/exampleWorker.js` reads the request body as a stream and answers with its size and sha256, which the `upload` route checks,
and `health.localhost`, whose worker answers `/health` and `/metrics` from the metrics the server gives to workers, which the `metrics` route checks.

### CPU bound worker

`cpu.ts` sends requests at a fixed rate to `examples/cpu/exampleWorker.js`, a worker that hashes in a loop, about 9 ms of a core per request. The rate is higher than one worker can follow
(about 110 requests per second), so the run only passes when the requests are spread over several workers. Run it on its own, as other traffic takes the cores that the workers need:
`WORKERS_PER_PATH=1` on the server fails it, with latencies of seconds and dropped requests.

```sh
k6 run tools/src/scripts/k6/cpu.ts
```

### Options

| Where | Name | Default | |
| --- | --- | --- | --- |
| server | `PORT_HTTP`, `PORT_HTTPS` | 8080, 8443 | ports of the server |
| server | `WORKERS_PER_PATH` | CPU cores | workers started per path, 1 reproduces the single worker bottleneck |
| k6 | `BASE_URL` | `http://localhost:8080` | |
| k6 | `HTTPS_PORT` | not set | enables the HTTPS and secure websocket routes |
| k6 | `VUS`, `WS_VUS`, `DURATION` | 20, 10, 30s | HTTP and websocket virtual users, duration |
| k6 | `MIN_REQUEST_RATE` | 1000 | requests per second the whole run has to reach |
| compare | `MAX_THROUGHPUT_DROP`, `MAX_P95_INCREASE`, `MAX_CPU_P95_INCREASE`, `MIN_P95_DIFFERENCE_MS` | 0.15, 0.5, 0.3, 5 | limits of the comparison with the base |
| k6 (`cpu.ts`) | `CPU_RATE`, `MAX_P95_MS` | 150, 50 | requests per second for the CPU bound worker, and the p95 allowed |

### Cores

The workflow gives the server and k6 cores of their own (`taskset`), so that they do not take cores from each other and the results depend less on how the runner schedules them: k6 gets one core in four (at least one),
the server the rest, which is 3 and 1 on the 4 core runners of public repositories. The pools of the server size themselves after the cores it may use, and the throughput floor is 250 requests per second for each of its cores.
Two cores for the server were not enough for the lambda route (a p95 of 140-160 ms), k6 uses about 70% of its core. To try the same locally, on a machine with 4 cores:

```sh
taskset -c 0-2 pnpm --filter @koeroesi86/node-webserver start:load-test &
taskset -c 3 k6 run -e HTTPS_PORT=8443 tools/src/scripts/k6/example.ts
```

### Comparison with the base

The absolute thresholds catch a collapse, not a slowdown, and the machines of shared runners differ too much from run to run to compare numbers of different runs: the same code has run at 3,300 and 4,600 requests per second.
So on a pull request the workflow also builds the base (the commit it is merged into) next to the pull request, and measures both **in the same job**, one at a time, alternating, three runs of 15 seconds each (`scripts/compare-with-base.ts`, with the logic in `utils/compare-with-base.ts`).
Both sides run the load test of the pull request against their own server, so that the load is the same. Then `utils/compare-summaries.ts` takes the median of the runs of each side and shows the change in the job summary:

- **throughput** is judged: a pull request with more than 15% less requests per second than the base fails (`MAX_THROUGHPUT_DROP`, 0.15),
- **the p95 of a route** is judged with wide limits, 50% and 5 milliseconds higher (`MAX_P95_INCREASE` 0.5, `MIN_P95_DIFFERENCE_MS` 5). The load is a fixed number of users, so a build that is faster gets more requests through
  every route, which makes the routes compete for the cores: the p95 of one route can rise while the build is better. The limits only catch a route that got much slower,
- a route that the base cannot serve (the pull request added it, which the checks per route show) is listed with n/a and not judged,
- the p95 of all requests and the connect time of the websocket are shown, not judged,
- **the CPU bound run** (`cpu.ts`, 10 seconds after every run of the example load test, on the same server) is compared as well. It has a fixed arrival rate, so its latency does not depend on how fast the other routes are,
  and tighter limits hold: a p95 more than 30% and 5 milliseconds higher fails (`MAX_CPU_P95_INCREASE`, 0.3), and so does a build that drops requests where the base does not. A base without the CPU bound worker is listed with n/a and not judged.
  The duration is the fifth argument of `compare-with-base.js`.

Same code on both sides measured within 2% of each other with runs that varied by 1-2%, while 0.2 milliseconds of extra work for every request (47% less throughput) failed it. The comparison needs a load test in the base:
for the pull request that adds the load test, and while the base cannot be built, the summary says there is nothing to compare with. Locally, with checkouts of both (`git worktree add ../base master`, install and build each), and the cores split as in the workflow:

```sh
SERVER_PREFIX='taskset -c 0-2' K6_PREFIX='taskset -c 3' node tools/dist/scripts/compare-with-base.js ../base . 3 15s 10s
```

The results are in `compare-results/`, the exit code is 1 on a regression. Each run also shows the processor of the runner and how much of the time it was held back by its host (steal time) in the job summary, which explains runs that are slow for no reason of the code.

### Thresholds

They were calibrated on the 4 core GitHub runners of public repositories (see the notes in `example.ts`) and are about twice the worst
value seen there. Private repositories run on 2 cores, and a different core count or user count needs different values.
The workflow scales the throughput floor with the core count of the runner.

`scripts/summary.ts` turns the k6 summary export into the job summary of the workflow, `scripts/runner.ts` describes the runner (`snapshot` before and after the test, then `report`), and `scripts/compare.ts` compares summary exports that exist already (`--base a.json b.json --head c.json d.json [--base-cpu ...] [--head-cpu ...]`). The default limits of the comparison are in `constants/comparison-limits.ts`.
