import type { RouteSelector } from '@koeroesi86/node-worker-express';

export type RedirectStatus = 301 | 302 | 307 | 308;

interface RuleOptions {
  /** the methods the rule is for, all of them when left out */
  methods?: string[];
}

/**
 * Answers a request with a redirect. The target is an absolute URL, whose scheme and host name are the ones written here, or a path on the same host. `{name}` in it is the named group of the pattern of that name, as the request wrote it,
 * with the characters that are not safe in a URL encoded. A capture can only go after the host name, so a request cannot redirect to a host of its choosing.
 */
export type RedirectRule = RouteSelector &
  RuleOptions & {
    redirect: string;
    /** `301` and `302` let a client turn a `POST` into a `GET`, `307` and `308` keep the method */
    status: RedirectStatus;
    /** whether the query of the request is added to the target. Defaults to true. */
    keepQuery?: boolean;
  };

/** Gives the server of the host another path than the one requested (the query is kept), `{name}` as in a redirect. The client does not see it. */
export type RewriteRule = RouteSelector &
  RuleOptions & {
    rewrite: string;
  };

/** The first rule of a host that matches the path (and the method) decides, one pass: the path a rewrite makes is not matched again. */
export type Rule = RedirectRule | RewriteRule;
