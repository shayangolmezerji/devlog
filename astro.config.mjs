import { defineConfig } from 'astro/config';

// Project page under a repo path, per https://docs.astro.build/en/guides/deploy/github/
// If the repo is renamed before push, `base` has to match the new name.
export default defineConfig({
  site: 'https://shayangolmezerji.github.io',
  base: '/devlog',
});
