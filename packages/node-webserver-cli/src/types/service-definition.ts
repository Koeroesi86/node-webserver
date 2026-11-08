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
