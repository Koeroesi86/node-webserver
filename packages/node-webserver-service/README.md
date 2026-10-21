# @koeroesi86/node-webserver-service

OS service integration for @koeroesi86/node-webserver

This package brings ability to deploy webapps a lot easier. Just copy [configuration.example.js](configuration.example.js) to `configuration.js`, modify it to your needs and start server instantly. Configuration also supported in `configuration.json` format.

### Requirements
* [NodeJS](https://nodejs.org/en/) 24 or newer
* Linux with systemd, or macOS with launchd. Nothing is compiled on install: the service definition is generated and loaded with `systemctl` / `launchctl`.
* Root (`sudo`) to install or remove a system service, not with `--user`. Without it the command fails and says so.

### Usage

```shell script
npm install @koeroesi86/node-webserver-service
```

Please enter in a console/terminal:

```shell script
sudo npx nws-service [argument] --configuration /path/to/configuration.js

arguments:
    --add      Installs, enables and starts the service
    --remove   Stops and removes the service
    --user     With --add or --remove: for the current user, no root (see below)
    --run      Runs the server in this process (what the service starts)
```

`--configuration` falls back to the `NODE_WEBSERVER_CONFIG` environment variable. Without either, `--add`, `--remove` and `--run` fail, there is no example server fallback. A failed command exits with a non-zero code.

The service is named after `serviceName` of the configuration (letters, digits, `_`, `.` and `-`), described by `serviceDisplayName`, and starts `node manage-service.js --run --configuration <absolute path>` in the folder of the configuration, with the `node` that ran `--add`.

| | Linux (systemd) | macOS (launchd) |
|---|---|---|
| File | `/etc/systemd/system/<serviceName>.service` | `/Library/LaunchDaemons/com.koeroesi86.<serviceName>.plist` |
| Loaded with | `systemctl enable --now` | `launchctl bootstrap system` |
| Restarts | `Restart=on-failure` | `KeepAlive` |
| Stop | `SIGTERM`, the server finishes its requests in flight | the same |
| Output | journald (`journalctl -u <serviceName>`) | `<fileLogPath>/<serviceName>.log` when `fileLogPath` is a folder |

Other keys of the configuration for the service: `serviceUser` is the user the service runs as (`User=` / `UserName`), root when missing. Run as a user that may bind the ports the servers use.

### For the current user

`--add --user` installs the service for the user that runs the command instead of the system, so it needs no root. `--remove` needs the same `--user` to find it.

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

Windows services need the service control protocol in the process, which a Node script does not speak, so `--add` and `--remove` do not support Windows. Run `node <package>/dist/scripts/manage-service.js --run --configuration <file>` from a tool made for it, for example:

* [WinSW](https://github.com/winsw/winsw) or [NSSM](https://nssm.cc/), which wrap the command as a service
* Task Scheduler: `schtasks /create /tn node-webserver /sc onstart /ru SYSTEM /tr "\"C:\\Program Files\\nodejs\\node.exe\" \"<package>\\dist\\scripts\\manage-service.js\" --run --configuration <file>"`

### Upgrading from 1.x

Version 1 used the `os-service` addon. A Windows service installed by it starts `manage-service.js --run` through the service control manager, which this version does not answer, so **remove it with the old version before upgrading**: `npx @koeroesi86/node-webserver-service@1 --remove --configuration <file>`. A Linux init.d service of the old version is not removed either, remove it the same way first. Then run `--add` with the new version on Linux or macOS.
