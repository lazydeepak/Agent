import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';

// Run after desktop:build. Uses disposable state and loopback fixtures only.
async function main() {
const directory = await mkdtemp(join(tmpdir(), 'agent-relay-electron-'));
app.setPath('userData', directory);
app.on('window-all-closed', () => {});
const servers = [];
try {
  await app.whenReady();
  const { openWorkerAuthWindowImpl } = await import('../desktop-dist/desktop/main/electron-window.js');
  for (const secret of ['first', 'second']) {
    const server = createServer((req, res) => {
      const authorized = req.headers.authorization === `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
      res.writeHead(authorized ? 200 : 401, { 'Content-Type': 'text/html' });
      res.end(authorized ? '<title>Authenticated worker</title>' : '<title>Unauthorized</title>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const origin = `http://127.0.0.1:${server.address().port}`;
    await openWorkerAuthWindowImpl({ url: `${origin}/session/one`, origin, title: secret, secret });
  }
  const windows = BrowserWindow.getAllWindows();
  assert.equal(windows.length, 2);
  for (const window of windows) assert.equal(window.getTitle(), 'Authenticated worker');
  assert.notEqual(windows[0].webContents.session, windows[1].webContents.session);
  windows[0].destroy();
  await windows[1].loadURL(windows[1].webContents.getURL());
  assert.equal(windows[1].getTitle(), 'Authenticated worker');
  windows[1].destroy();
  console.log('PASS: real Electron Basic auth, concurrent server isolation, and close/reload');

  const config = join(directory, 'pairs.json');
  await writeFile(config, '{"pairs":[]}');
  process.argv = [process.argv[0], 'agent-relay', '--config', config, '--db', join(directory, 'relay.sqlite')];
  await import('../desktop-dist/desktop/main/index.js');
  const deadline = Date.now() + 15000;
  let dashboard;
  while (Date.now() < deadline) {
    dashboard = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/index.html'));
    if (dashboard && !dashboard.webContents.isLoading()) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(dashboard, 'Dashboard must open');
  const pairs = await dashboard.webContents.executeJavaScript('window.desktop.listPairs()');
  assert.deepEqual(pairs, []);
  console.log('PASS: dashboard startup, sandboxed preload, and live IPC');
  process.emit('SIGTERM');
} catch (error) {
  console.error(error);
  app.exit(1);
} finally {
  for (const server of servers) server.close();
}
}
void main();
