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

## Options

| Where | Name | Default | |
| --- | --- | --- | --- |
| server | `PORT_HTTP`, `PORT_HTTPS` | 8080, 8443 | ports of the server |
| server | `WORKERS_PER_PATH` | CPU cores | workers started per path, 1 reproduces the single worker bottleneck |
| k6 | `BASE_URL` | `http://localhost:8080` | |
| k6 | `HTTPS_PORT` | not set | enables the HTTPS and secure websocket routes |
| k6 | `VUS`, `WS_VUS`, `DURATION` | 20, 10, 30s | HTTP and websocket virtual users, duration |
| k6 | `MIN_REQUEST_RATE` | 760 | requests per second the whole run has to reach |

## Thresholds

They were calibrated on the 4 core GitHub runners of public repositories (see the notes in `example.js`) and are about twice the worst
value seen there. Private repositories run on 2 cores, and a different core count or user count needs different values.
The workflow scales the throughput floor with the core count of the runner.

`summary.js` turns the k6 summary export into the job summary of the workflow.
