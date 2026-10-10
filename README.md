# node-webserver

[![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg?branch=master)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
[![CodeQL](https://github.com/Koeroesi86/node-webserver/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/Koeroesi86/node-webserver/actions/workflows/codeql.yml)

A local web server that hosts workers, lambdas and proxied apps by virtual host, and the libraries it is built on.
Everything in this repository is published to npm under the `@koeroesi86` scope.

## Design

One Node.js server sits in front and acts as a lightweight, cheap proxy to other processes. It accepts the connections, finds the server definition for the host name, and hands each request to whatever runs behind it:

| Server type | What runs behind the front server |
|---|---|
| `worker` | a pool of Node processes per worker file, which answer requests with a function (`event`, `callback`), also by streaming the response and reading the request body as a stream |
| `lambda` | AWS Lambda style handlers, each in a process of its own |
| `child` | any other application, started as a child process and proxied to |
| `proxy` | an application that runs on its own, at a fixed address or at one it registers itself, like a dyndns update |

The front server stays a single process on purpose. It does as little as possible for every request, and the work, the memory and the isolation live in the processes behind it: a worker that crashes or leaks takes only itself down,
and CPU heavy handlers spread over the cores through their own pools. What this means for the code:

- The cost of a request on the front process is what limits the throughput of the whole server, so everything that is done for every request there (resolving the path, the messages to the worker, logging) is kept small and measured, see [the load test](tools/README.md#load-tests).
  Work that does not have to happen there, like heavy compression, is better done behind it or in front of it, by a reverse proxy or CDN.
- Scaling out means more workers, lambdas or child processes behind the front server, not more front servers.
- Backends talk to the front server over channels it controls (messages with acknowledgements, so a slow side slows the other down instead of filling memory), which also lets a worker ask the server for its metrics.

## Packages

| Package | Latest version | Description |
|---|---|---|
| [@koeroesi86/node-webserver](https://www.npmjs.com/package/@koeroesi86/node-webserver) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-webserver?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-webserver) | The web server. [Source](packages/node-webserver) |
| [@koeroesi86/node-webserver-cli](https://www.npmjs.com/package/@koeroesi86/node-webserver-cli) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-webserver-cli?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-webserver-cli) | Command line runner for the web server. [Source](packages/node-webserver-cli) |
| [@koeroesi86/node-webserver-service](https://www.npmjs.com/package/@koeroesi86/node-webserver-service) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-webserver-service?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-webserver-service) | Runs the web server as an operating system service. [Source](packages/node-webserver-service) |
| [@koeroesi86/node-lambda-invoke](https://www.npmjs.com/package/@koeroesi86/node-lambda-invoke) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-lambda-invoke?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-lambda-invoke) | Invoke AWS Lambda style handlers locally. [Source](packages/node-lambda-invoke) |
| [@koeroesi86/node-worker-express](https://www.npmjs.com/package/@koeroesi86/node-worker-express) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-worker-express?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-worker-express) | Express middleware that runs a worker per request. [Source](packages/node-worker-express) |
| [@koeroesi86/node-worker](https://www.npmjs.com/package/@koeroesi86/node-worker) | [![npm](https://img.shields.io/npm/v/@koeroesi86/node-worker?label=npm)](https://www.npmjs.com/package/@koeroesi86/node-worker) | NodeJS implementation of WebWorkers. [Source](packages/node-worker) |

`node-webserver` depends on `node-lambda-invoke` and `node-worker-express`, `node-worker-express` depends on `node-worker`, and `node-webserver-cli` and `node-webserver-service` depend on `node-webserver`.
The pipeline publishes a package when it, or a workspace package it depends on, changed since its latest release. Versions are stamped by the pipeline, see [tools/src/version.ts](tools/src/version.ts).

## Usage

Install what you need from npm, for example:

```bash
npm install @koeroesi86/node-webserver
```

See the README of each package for details.

## Development

This is a [pnpm](https://pnpm.io/) workspace.

```bash
corepack enable
pnpm install
pnpm build   # compile every package, in dependency order
pnpm lint
pnpm test               # unit tests of every package
pnpm test:integration   # starts the built server with one server of every type (worker, lambda, child) and sends requests to them
pnpm start   # run the web server with the example configuration
```
