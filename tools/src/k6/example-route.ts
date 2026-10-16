import type { RefinedResponse, ResponseType } from 'k6/http';

export type Response = RefinedResponse<ResponseType | undefined>;

export interface Route {
  method: string;
  /** a function makes the url anew for every request */
  url: string | (() => string);
  host?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  /** the body of the response is read as bytes */
  binary?: boolean;
  status: number;
  /** only every n-th iteration requests the route */
  every?: number;
  validate: (response: Response) => boolean;
  maxP95: number;
}
