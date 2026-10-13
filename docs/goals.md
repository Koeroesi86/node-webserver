# Goals

## What it is for

A local web server that hosts several apps on one machine by virtual host, so that deploying a web app is a copy of a file and a line of configuration.

- **Host different kinds of apps behind one address.** Plain request handlers (workers), AWS Lambda style handlers, any other application started as a child process, and apps that run on their own and are proxied to.
- **Run lambdas locally as AWS runs them.** The event, the context and the answers to failures are the ones of API Gateway with the proxy integration, so the code runs unchanged in both places.
- **Keep the front process cheap.** It is the one place every request passes, so what limits it limits the whole server. Everything that can happen behind it does.
- **Isolate the apps from each other.** A worker that crashes or leaks takes only itself down.
- **Stay up while things change.** Servers reload when their files change, and a stop lets the requests in flight finish.
- **Be small to operate.** One configuration file, plain Node.js, packages that can be used on their own from npm.

## What it is not for

- **Not a set of front servers.** Scaling out means more workers, lambdas and child processes behind the one front server, not more front servers.
- **Not a file server.** Files are served by the static worker, not by the front process.
- **Not an edge.** Heavy compression and TLS for many new connections are better done by a reverse proxy or CDN in front of it, though both are supported.
- **Not a copy of AWS.** The differences from Lambda are listed in the [README of the server](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md#lambdas) (one request per process, queueing instead of scaling out, no frozen environment).

## How decisions are made

Performance work is ranked by what the [load tests](https://github.com/Koeroesi86/node-webserver/blob/master/tools/README.md#load-tests) measured, not by guesses. Every load test is meant to block a merge when it fails, so noisy runs are stabilised rather than dropped.
