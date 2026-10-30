const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../dist-local');
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Export the local web app first: node scripts/export-local-web.cjs');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const segments = name.split(/[\\/]/);
  if (segments.some(s => s.startsWith('.') && s !== '')) { res.writeHead(404).end(); return; }
  let file = path.resolve(root, '.' + name);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
  if (!path.extname(file)) file = path.join(root, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? 'Port 8081 is already in use. Stop the previous web preview first.' : e.message); process.exitCode = 1; });
server.listen(8081, '0.0.0.0', () => console.log('Local CallTrack preview: http://localhost:8081'));
