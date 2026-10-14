---
applyTo: "packages/node-webserver/**,packages/node-worker/**,packages/node-worker-express/**,packages/node-lambda-invoke/**"
---

# Server architecture instructions

- The front process is a single, cheap proxy. Do not move request-path work there when it can be done behind the proxy.
- Do not serve static files from the front process; static hosting belongs to the static worker.
- Read the design section in the relevant package README before changing the request path, routing logic, worker boundaries, or proxy behavior.
- Prefer the existing worker/lambda/proxy patterns instead of introducing unneeded abstractions.
- Keep requests cheap: perform the minimal work needed per request and push expensive or reusable work behind the front proxy.
- If a request-path change affects performance, measure it with the load-test workflow and document the result.
- Keep package boundaries clear: do not create cross-package coupling unless the architecture already expects it.
- Any change to HTTP, TLS, proxying, compression, logging, or worker execution behavior should be validated with the relevant integration or load-test checks.
