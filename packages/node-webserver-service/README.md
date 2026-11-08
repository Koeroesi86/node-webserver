# @koeroesi86/node-webserver-service

**Deprecated.** The service commands are part of [@koeroesi86/node-webserver-cli](../node-webserver-cli/README.md#as-a-service) now, use `nws-cli service add|remove` there. This package only forwards to it, so a service installed by it keeps running, and is kept until the services have moved.

```shell script
npm install @koeroesi86/node-webserver-cli
sudo npx nws-cli service add --config /path/to/configuration.js
```

### Forwarding

`nws-service` prints that it is deprecated with the command to use, runs `nws-cli` with the arguments translated, passes `SIGTERM`, `SIGINT` and `SIGHUP` on, and ends with the exit code or the signal of `nws-cli`:

| `nws-service` | `nws-cli` |
|---|---|
| `--add --configuration <file>` | `service add --config <file>` |
| `--remove --configuration <file>` | `service remove --config <file>` |
| `--user` (with `--add` or `--remove`) | `--user` |
| `--run --configuration <file>` | `--config <file>` |

`--add` therefore writes a definition that starts `nws-cli` directly, not this package. Restart the service afterwards, see [Coming from `@koeroesi86/node-webserver-service`](../node-webserver-cli/README.md#coming-from-koeroesi86node-webserver-service).

### Upgrading from 1.x

Version 1 used the `os-service` addon. A Windows service installed by it starts `manage-service.js --run` through the service control manager, which this version does not answer, so **remove it with the old version before upgrading**: `npx @koeroesi86/node-webserver-service@1 --remove --configuration <file>`. A Linux init.d service of the old version is not removed either, remove it the same way first. Then run `--add` with the new version on Linux or macOS.
