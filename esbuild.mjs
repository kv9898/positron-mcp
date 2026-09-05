import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode', 'positron'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  sourcemap: true,
  minify: false,
};

if (watch) {
  const context = await esbuild.context({
    ...options,
    plugins: [{
      name: 'watch-status',
      setup(build) {
        build.onStart(() => {
          console.log('[watch] build started');
        });
        build.onEnd(result => {
          if (result.errors.length === 0) {
            console.log('[watch] build finished, watching for changes...');
          }
        });
      },
    }],
  });
  await context.watch();
} else {
  await esbuild.build(options);
}
