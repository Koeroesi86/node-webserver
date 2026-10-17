/** something wrong with the configuration, with where it is: an error stops the server from starting or loading, a warning is only reported */
export interface ConfigurationProblem {
  severity: 'error' | 'warning';
  /** the host name of the server, or its file when it is not loaded yet; undefined for a setting of the configuration itself */
  server?: string;
  /** the path of the setting in the configuration or the server, like `proxyOptions.target` */
  setting: string;
  message: string;
}
