const { spawnSync } = require('node:child_process');
const flag = process.argv.indexOf('--api-url');
const apiUrl = flag >= 0 ? process.argv[flag + 1] : process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';
const parsed = new URL(apiUrl);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
  throw new Error('Supply a public HTTP(S) API address without credentials.');
const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', 'dist-local', '--max-workers', '2'], {
  cwd: require('node:path').resolve(__dirname, '..'),
  env: { ...process.env, CI: '1', EXPO_NO_METRO_WORKSPACE_ROOT: '1', EXPO_PUBLIC_API_URL: apiUrl.replace(/\/$/, '') },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const fs = require('node:fs'), path = require('node:path');
const output = path.resolve(__dirname, '../dist-local');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const script = html.match(/src="([^"]+\.js)"/);
if (!script || !fs.readFileSync(path.join(output, script[1].replace(/^\//, '')), 'utf8').includes(apiUrl.replace(/\/$/, '')))
  throw new Error('The exported web bundle contains a stale API target. Rebuild with a cleared Metro cache.');
console.log('Verified local web API target: ' + apiUrl);
