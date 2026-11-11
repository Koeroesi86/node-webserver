import findPatternProblems from './find-pattern-problems';
import type { ConfigurationProblem, Rule } from '../types';

const namedGroups = (pattern?: string) => [...(pattern ?? '').matchAll(/\(\?<([A-Za-z_$][\w$]*)>/g)].map(([, name]) => name);
const placeholders = (target: string) => [...target.matchAll(/\{(\w+)\}/g)].map(([, name]) => name);

/** a scheme and a host name, written out, and nothing of the request in them */
const hasFixedHost = (target: string) => /^[a-z][a-z0-9+.-]*:\/\/[^/?#{}\\@]+(?:[/?#]|$)/i.test(target);
const isLocalPath = (target: string) => /^\/(?![/\\])/.test(target);

const findTargetProblems = (rule: Rule, setting: string, server: string): ConfigurationProblem[] => {
  const target = 'redirect' in rule ? rule.redirect : rule.rewrite;
  const place = 'redirect' in rule ? 'a path that starts with a single / or an absolute URL with a host name of its own' : 'a path that starts with a single /';
  const valid = isLocalPath(target) || ('redirect' in rule && hasFixedHost(target));
  const groups = namedGroups('pattern' in rule ? rule.pattern : undefined);

  return [
    ...(valid ? [] : [{ severity: 'error' as const, server, setting, message: `has to be ${place}, with no part of the request in the host name` }]),
    ...placeholders(target)
      .filter((name) => !groups.includes(name))
      .map((name) => ({ severity: 'error' as const, server, setting, message: `has {${name}}, which is not a named group of the pattern` })),
  ];
};

const findMethodProblems = (rule: Rule, setting: string, server: string): ConfigurationProblem[] =>
  'redirect' in rule && [301, 302].includes(rule.status) && rule.methods?.some((method) => !['GET', 'HEAD'].includes(method.toUpperCase()))
    ? [
        {
          severity: 'warning',
          server,
          setting: `${setting}.status`,
          message: 'lets a client turn a request that is not GET or HEAD into a GET, use 307 or 308 to keep the method',
        },
      ]
    : [];

/** what the schema cannot say about the rules of a server: patterns that are not regular expressions, and targets that go where a request can choose or use a group that is not there */
const findRuleProblems = ({ rules = [] }: { rules?: Rule[] }, server: string): ConfigurationProblem[] => [
  ...findPatternProblems(
    server,
    'rules',
    rules.map((rule) => ('pattern' in rule ? rule : {}))
  ),
  ...rules.flatMap((rule, position) => {
    const setting = `rules[${position}]`;
    return [...findTargetProblems(rule, `${setting}.${'redirect' in rule ? 'redirect' : 'rewrite'}`, server), ...findMethodProblems(rule, setting, server)];
  }),
];

export default findRuleProblems;
