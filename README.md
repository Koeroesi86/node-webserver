# node-webserver

[![Publish](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml/badge.svg?branch=master)](https://github.com/Koeroesi86/node-webserver/actions/workflows/publish.yml)
[![Pull request build](https://github.com/Koeroesi86/node-webserver/actions/workflows/build.yml/badge.svg?event=pull_request)](https://github.com/Koeroesi86/node-webserver/actions/workflows/build.yml)
[![CodeQL](https://github.com/Koeroesi86/node-webserver/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/Koeroesi86/node-webserver/actions/workflows/codeql.yml)

A local web server that hosts workers, lambdas and proxied apps by virtual host, and the libraries it is built on.
Everything in this repository is published to npm under the `@koeroesi86` scope.

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
pnpm test
pnpm start   # run the web server with the example configuration
```
