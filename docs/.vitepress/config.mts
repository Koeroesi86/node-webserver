import { defineConfig } from 'vitepress';

// the site is a project page of the repository, so every path starts with its name
export default defineConfig({
  title: 'node-webserver',
  description: 'A web server that hosts workers, lambdas and proxied apps by virtual host.',
  base: '/node-webserver/',
  cleanUrls: true,
  // README.md is the index of the folder on GitHub, the site starts there too
  rewrites: { 'README.md': 'index.md' },
  themeConfig: {
    nav: [
      { text: 'Docs', link: '/goals' },
      { text: 'npm', link: 'https://www.npmjs.com/org/koeroesi86' },
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Goals', link: '/goals' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Server types', link: '/server-types' },
          { text: 'Behaviour', link: '/behaviour' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'Development', link: '/development' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Koeroesi86/node-webserver' }],
    editLink: { pattern: 'https://github.com/Koeroesi86/node-webserver/edit/master/docs/:path', text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
  },
});
