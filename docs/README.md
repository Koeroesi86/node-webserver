# Documentation

Short pages on what this repository is for and how it behaves. The details of every option live in the README of the package that owns it, these pages link there instead of repeating them.

| Page | Read it to know |
|---|---|
| [Goals](goals.md) | what the project is for, and what it is not |
| [Architecture](architecture.md) | the processes, the request path and the channels between them |
| [Server types](server-types.md) | what `worker`, `lambda`, `child` and `proxy` servers do and when to pick which |
| [Behaviour](behaviour.md) | what the server does under load, on failure, on a reload and on a stop |
| [Configuration](configuration.md) | the shape of the configuration and the top level options |
| [Development](development.md) | how to build, check, test and release a change |

Where to look for the rest:

- using the server: [packages/node-webserver/README.md](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver/README.md)
- the libraries: [node-worker](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker/README.md), [node-worker-pool](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-pool/README.md), [node-worker-express](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-worker-express/README.md), [node-lambda-invoke](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-lambda-invoke/README.md)
- the command line and the systemd or launchd service: [node-webserver-cli](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver-cli/README.md), [node-webserver-service](https://github.com/Koeroesi86/node-webserver/blob/master/packages/node-webserver-service/README.md)
- versions and load tests: [tools/README.md](https://github.com/Koeroesi86/node-webserver/blob/master/tools/README.md)
