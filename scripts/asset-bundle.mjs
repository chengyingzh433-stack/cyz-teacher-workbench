import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
export const embedPixelAssets = {
  name: 'embed-pixel-assets',
  setup(build) {
    build.onLoad({ filter: /[/\\]art[/\\]assets\.js$/ }, async (args) => {
      let contents = await readFile(args.path, 'utf8');
      const paths = [...new Set(contents.match(/\/assets\/pixel\/[\w-]+\.png/g))];
      for (const path of paths) {
        const bytes = await readFile(new URL('.' + path, root));
        contents = contents.replaceAll(path, 'data:image/png;base64,' + bytes.toString('base64'));
      }
      return {
        contents,
        loader: 'js',
        resolveDir: fileURLToPath(new URL('../src/art/', import.meta.url))
      };
    });
  }
};
