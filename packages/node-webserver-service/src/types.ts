/** what the service integration needs from the configuration, on top of the web server options */
export interface ServiceConfiguration {
  serviceName: string;
  serviceDisplayName?: string;
}
