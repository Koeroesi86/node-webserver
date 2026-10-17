/** what the service integration needs from the configuration, on top of the web server options */
export interface ServiceConfiguration {
  serviceName: string;
  serviceDisplayName?: string;
  /** the user the service runs as, root when missing */
  serviceUser?: string;
  /** a folder, launchd writes the output of the service to a file in it (systemd has the journal) */
  fileLogPath?: string | null;
}

/** everything the generators need to describe the service, all paths absolute */
export interface ServiceDefinition {
  name: string;
  displayName: string;
  nodePath: string;
  scriptPath: string;
  configPath: string;
  workingDirectory: string;
  user?: string;
  /** installs for the current user (systemd user manager, LaunchAgents) instead of the system */
  userService?: boolean;
  logFolder?: string;
}
