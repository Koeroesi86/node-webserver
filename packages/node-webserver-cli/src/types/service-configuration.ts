/** what the service integration needs from the configuration, on top of the web server options */
export interface ServiceConfiguration {
  serviceName: string;
  serviceDisplayName?: string;
  /** the user the service runs as, root when missing */
  serviceUser?: string;
  /** a folder, launchd writes the output of the service to a file in it (systemd has the journal) */
  fileLogPath?: string | null;
}
