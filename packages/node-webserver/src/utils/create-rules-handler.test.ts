import express from 'express';
import http from 'http';
import createRulesHandler from './create-rules-handler';
import type { Rule } from '../types';

describe('createRulesHandler', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => {
        server.closeAllConnections();
        return new Promise((resolve) => server.close(resolve));
      })
    );
  });

  /** the server of the host answers with what it got */
  const request = async (rules: Rule[], path: string, method = 'GET') => {
    const server = http.createServer(
      express()
        .use(createRulesHandler(rules))
        .use((req, res) => res.type('text/plain').send(`${req.method} ${req.url} ${req.originalUrl}`))
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));

    return new Promise<{ status: number; location?: string; body: string }>((resolve, reject) => {
      http
        .request({ port: (server.address() as { port: number }).port, path, method }, (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, location: response.headers.location, body: Buffer.concat(chunks).toString() }));
        })
        .on('error', reject)
        .end();
    });
  };

  describe('redirects', () => {
    it('sends a path to another with the status of the rule', async () => {
      const response = await request([{ path: '/old', redirect: '/new', status: 301 }], '/old');

      expect(response.status).toBe(301);
      expect(response.location).toBe('/new');
    });

    it.each([301, 302, 307, 308] as const)('answers with %s', async (status) => {
      expect((await request([{ path: '/old', redirect: '/new', status }], '/old')).status).toBe(status);
    });

    it('puts the named captures into the target, and adds the query', async () => {
      const response = await request(
        [{ pattern: '/blog/(?<year>[0-9]{4})/(?<slug>.+)', redirect: '/posts/{slug}-{year}', status: 308 }],
        '/blog/2024/hello%20world?a=1'
      );

      expect(response.location).toBe('/posts/hello%20world-2024?a=1');
    });

    it('leaves the query out when asked, and joins it to the one of the target', async () => {
      const rules: Rule[] = [
        { path: '/a', redirect: '/b', status: 302, keepQuery: false },
        { path: '/c', redirect: '/d?x=1', status: 302 },
      ];

      expect((await request(rules, '/a?q=1')).location).toBe('/b');
      expect((await request(rules, '/c?q=1')).location).toBe('/d?x=1&q=1');
    });

    it('moves a host to another with an absolute target, whatever the path', async () => {
      const response = await request([{ pattern: '/(?<rest>.*)', redirect: 'https://example.com/{rest}', status: 301 }], '/a/b?c=d');

      expect(response.location).toBe('https://example.com/a/b?c=d');
    });

    it('does not let a capture make the target another host', async () => {
      const rules: Rule[] = [{ pattern: '/(?<rest>.*)', redirect: '/{rest}', status: 301 }];

      expect((await request(rules, '//evil.com')).status).toBe(400);
      expect((await request(rules, '/%5Cevil.com')).location).toBe('/%5Cevil.com');
      expect((await request(rules, '/\\evil.com')).location).toBe('/%5Cevil.com');
    });

    it('keeps the capture behind the host name of an absolute target', async () => {
      const response = await request([{ pattern: '/(?<rest>.*)', redirect: 'https://example.com/{rest}', status: 301 }], '//evil.com/x');

      expect(response.location).toBe('https://example.com//evil.com/x');
    });
  });

  describe('rewrites', () => {
    it('gives the server the other path, with the query, and keeps the original url', async () => {
      const response = await request([{ pattern: '/app/.*', rewrite: '/index.html' }], '/app/users/7?tab=1');

      expect(response.body).toBe('GET /index.html?tab=1 /app/users/7?tab=1');
    });

    it('uses the captures', async () => {
      const response = await request([{ pattern: '/v1/(?<rest>.*)', rewrite: '/api/{rest}' }], '/v1/users');

      expect(response.body).toBe('GET /api/users /v1/users');
    });

    it('answers 400 for a path that would be another host', async () => {
      expect((await request([{ pattern: '/(?<rest>.*)', rewrite: '/{rest}' }], '//evil.com')).status).toBe(400);
    });

    it('is matched once: a rewrite is not matched by the rules again', async () => {
      const rules: Rule[] = [
        { path: '/a', rewrite: '/b' },
        { path: '/b', redirect: '/c', status: 301 },
      ];

      expect((await request(rules, '/a')).body).toBe('GET /b /a');
    });
  });

  describe('matching', () => {
    it('passes on the requests no rule matches, and any request without rules', async () => {
      expect((await request([{ path: '/old', redirect: '/new', status: 301 }], '/other')).body).toBe('GET /other /other');
      expect((await request([], '/old')).body).toBe('GET /old /old');
    });

    it('lets the first rule in the order of the configuration win, a path or a pattern', async () => {
      const rules: Rule[] = [
        { pattern: '/a.*', redirect: '/first', status: 302 },
        { path: '/ab', redirect: '/second', status: 302 },
      ];

      expect((await request(rules, '/ab')).location).toBe('/first');
    });

    it('applies a rule with methods to these only, not case sensitive, and goes on to the next rule', async () => {
      const rules: Rule[] = [
        { path: '/form', methods: ['post'], redirect: '/post', status: 307 },
        { path: '/form', redirect: '/other', status: 302 },
      ];

      expect((await request(rules, '/form', 'POST')).location).toBe('/post');
      expect((await request(rules, '/form', 'GET')).location).toBe('/other');
    });

    it('keeps the order between rules with and without methods', async () => {
      const rules: Rule[] = [
        { path: '/x', redirect: '/one', status: 302 },
        { path: '/x', methods: ['GET'], redirect: '/two', status: 302 },
        { pattern: '/.*', redirect: '/three', status: 302 },
      ];

      expect((await request(rules, '/x')).location).toBe('/one');
      expect((await request(rules, '/y')).location).toBe('/three');
    });
  });
});
