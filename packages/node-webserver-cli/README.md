# @koeroesi86/node-webserver-cli

CLI for [@koeroesi86/node-webserver](../node-webserver).

### Dependencies to run
* [NodeJS](https://nodejs.org/en/)

### Usage:

```shell script
npm install @koeroesi86/node-webserver-cli
npx nws-cli --config </path/to/config>
```

To check a configuration and the server files it names without starting anything, for CI or before a deploy or a `SIGHUP`:

```shell script
npx nws-cli --config </path/to/config> --check
```

It prints every problem with its server and setting, and exits with 1 when there is an error. What is checked is in the [README of the server](../node-webserver/README.md#checking-the-configuration).

`--config` falls back to the `NODE_WEBSERVER_CONFIG` environment variable. Without either the command fails, there is no example server to fall back to. A failed command exits with a non-zero code.

### As a service

```shell script
sudo npx nws-cli service add --config </path/to/config>
sudo npx nws-cli service remove --config </path/to/config>
```

`service add` installs, enables and starts the service, `service remove` stops and removes it. Without an action `nws-cli service` prints the usage. It needs:

* Linux with systemd, macOS with launchd, or Windows with Task Scheduler. Nothing is compiled on install: the service definition is generated and loaded with `systemctl` / `launchctl` / `schtasks`.
* Root (`sudo`), or an administrator on Windows, to install or remove a system service, not with `--user`. Without it the command fails and says so.

The service is named after `serviceName` of the configuration (letters, digits, `_`, `.` and `-`), described by `serviceDisplayName`, and starts `node cli.js --config <absolute path>` in the folder of the configuration, with the `node` that ran `service add`.

| | Linux (systemd) | macOS (launchd) |
|---|---|---|
| File | `/etc/systemd/system/<serviceName>.service` | `/Library/LaunchDaemons/com.koeroesi86.<serviceName>.plist` |
| Loaded with | `systemctl enable --now` | `launchctl bootstrap system` |
| Restarts | `Restart=on-failure` | `KeepAlive` |
| Stop | `SIGTERM`, the server finishes its requests in flight | the same |
| Output | journald (`journalctl -u <serviceName>`) | `<fileLogPath>/<serviceName>.log` when `fileLogPath` is a folder |

Other keys of the configuration for the service: `serviceUser` is the user the service runs as (`User=` / `UserName`), root when missing. Run as a user that may bind the ports the servers use.

### For the current user

`service add --user` installs the service for the user that runs the command instead of the system, so it needs no root. `service remove` needs the same `--user` to find it.

| | Linux (systemd) | macOS (launchd) |
|---|---|---|
| File | `~/.config/systemd/user/<serviceName>.service` | `~/Library/LaunchAgents/com.koeroesi86.<serviceName>.plist` |
| Loaded with | `systemctl --user enable --now` | `launchctl bootstrap gui/<uid>` |
| Starts | `WantedBy=default.target`, at login | at login (`RunAtLoad`) |

* `serviceUser` and `--user` exclude each other: the service runs as the user who installed it, and systemd rejects `User=` in a user unit.
* A user service cannot bind ports below 1024.
* On Linux a user service stops with the last session of the user, which looks like a crash. Run `loginctl enable-linger` once (as that user) to start it at boot and keep it running without a login.
* `systemctl --user` needs the user session bus: over `ssh` or `sudo -u` it may fail with "Failed to connect to bus", log in as the user or set `XDG_RUNTIME_DIR=/run/user/$(id -u)`.

Linux without systemd (init.d, upstart) is not supported anymore.

### Windows

A Windows service needs the service control protocol in the process, which a Node script does not speak. `service add` therefore installs a task of Task Scheduler (`schtasks`), which ships with Windows, instead of a service. Run it from an elevated prompt.

| | System | `--user` |
|---|---|---|
| File | `%ProgramData%\nws-cli\<serviceName>.xml` | `%LocalAppData%\nws-cli\<serviceName>.xml` |
| Loaded with | `schtasks /create /xml` then `/run` | the same |
| Starts | at boot, as `SYSTEM` | at the logon of the user, without elevation |
| Restarts | every minute after a failure, 999 times | the same |
| Stop | `schtasks /end` (ends the process, the requests in flight are lost) | the same |
| Output | none, Task Scheduler does not keep it | none |

* `serviceUser` is not supported on Windows (a task needs the password of another user), and `fileLogPath` has no effect: log from the server itself.
* The task is not in `services.msc`: manage it in Task Scheduler or with `schtasks /query /tn <serviceName>`.
* A tool that wraps the command as a real service, such as [WinSW](https://github.com/winsw/winsw) or [NSSM](https://nssm.cc/), works too: run `nws-cli --config <file>` from it.

### Coming from `@koeroesi86/node-webserver-service`

The service commands were part of `@koeroesi86/node-webserver-service` (`nws-service`), which is deprecated and forwards to this package. The names changed:

| `nws-service` | `nws-cli` |
|---|---|
| `--add --configuration <file>` | `service add --config <file>` |
| `--remove --configuration <file>` | `service remove --config <file>` |
| `--user` | `--user` |
| `--run --configuration <file>` | `--config <file>` |

A service installed by `nws-service` keeps running through the forwarding of the old package. To move it, run `service add` of this package with the same configuration (it rewrites the definition of the same name, which starts `nws-cli` itself), then restart it: `systemctl restart <serviceName>` (`systemctl --user restart` for `--user`) or `launchctl kickstart -k <domain>/com.koeroesi86.<serviceName>`.
