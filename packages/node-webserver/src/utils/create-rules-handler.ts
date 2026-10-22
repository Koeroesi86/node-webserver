import { createRouteMatcher } from '@koeroesi86/node-worker-express';
import fillRuleTarget from './fill-rule-target';
import type { RequestHandler } from 'express';
import type { Rule } from '../types';

/** the target is a path of this host (not `//host`, which a browser reads as another one), or an absolute URL */
const isPlace = (target: string) => /^\/(?![/\\])/.test(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target);

const addQuery = (target: string, query: string) => (query ? `${target}${target.includes('?') ? '&' : '?'}${query}` : target);

/** rules without methods are one table, as a table is where the cost does not grow with the number of rules, one with methods is a table of its own, so that the order of the rules stays the one written */
const groupRules = (rules: Rule[]) =>
  rules.reduce<Rule[][]>((groups, rule) => {
    const last = groups.at(-1);
    return rule.methods || !last || last[0].methods ? [...groups, [rule]] : [...groups.slice(0, -1), [...last, rule]];
  }, []);

const createGroup = (rules: Rule[]) => ({
  methods: rules[0].methods && new Set(rules[0].methods.map((method) => method.toUpperCase())),
  match: createRouteMatcher(rules, (rule) => rule),
});

type Group = ReturnType<typeof createGroup>;

/** the tables are asked in order, and no more of them once one has matched */
const findRule = (groups: Group[], method: string, pathname: string) =>
  groups.reduce<ReturnType<Group['match']>>((found, { methods, match }) => found ?? (!methods || methods.has(method) ? match(pathname) : undefined), undefined);

/**
 * Redirects and rewrites a request before the server of its host gets it. The first rule that matches the path (without the query, as the client wrote it) decides, once: the path of a rewrite is not matched again.
 * A target that does not come out as a place, because a capture started it with a second slash, is answered with 400 and not followed.
 */
const createRulesHandler = (rules: Rule[]): RequestHandler => {
  const groups = rules.length ? groupRules(rules).map(createGroup) : [];

  return (request, response, next) => {
    const queryStart = request.url.indexOf('?');
    const pathname = (queryStart === -1 ? request.url : request.url.slice(0, queryStart)) || '/';
    const query = queryStart === -1 ? '' : request.url.slice(queryStart + 1);
    const found = findRule(groups, request.method, pathname);

    if (!found) return next();

    const { target: rule, pathParameters } = found;
    const target = fillRuleTarget('redirect' in rule ? rule.redirect : rule.rewrite, pathParameters);

    if (!isPlace(target) || ('rewrite' in rule && !target.startsWith('/'))) {
      response.status(400).type('text/plain').send('Bad Request');
      return;
    }

    if ('redirect' in rule) {
      response.redirect(rule.status, rule.keepQuery === false ? target : addQuery(target, query));
      return;
    }

    request.url = addQuery(target, query);
    next();
  };
};

export default createRulesHandler;
