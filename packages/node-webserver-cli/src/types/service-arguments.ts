/** the arguments after `service` */
export interface ServiceArguments {
  /** add or remove, anything else is for the usage */
  action?: string;
  user: boolean;
  config?: string;
}
