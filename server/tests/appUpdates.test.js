import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { appUpdateRoutes } from '../routes/appUpdateRoutes.js';

test('private APK release checks authentication, role, checksum and production signing metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'calltrack-release-test-'));
  try {
    const bytes = Buffer.from('Test binary fixture; not an installable APK');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(directory, 'fixture.apk'), bytes);
    const release = { apps: {
      agent: { filename: 'fixture.apk', version: '1.2.0', versionCode: 12, packageName: 'com.calltrack.dialer', signing: 'preview', sha256 },
      admin: { filename: 'fixture.apk', version: '1.2.0', versionCode: 12, packageName: 'com.calltrack.crm', signing: 'preview', sha256 },
    } };
    await writeFile(path.join(directory, 'release.json'), JSON.stringify(release));
    const app = (nodeEnv = 'test') => {
      const instance = express();
      instance.use((req, _res, next) => { if (req.headers['x-test-role']) req.user = { role: req.headers['x-test-role'] }; next(); });
      instance.use('/api', appUpdateRoutes({ directory, nodeEnv }));
      instance.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
      return instance;
    };
    await request(app()).get('/api/app-updates').expect(401);
    await request(app()).get('/api/app-updates?variant=admin').set('x-test-role', 'agent').expect(403);
    const meta = await request(app()).get('/api/app-updates?variant=agent&versionCode=11').set('x-test-role', 'agent').expect(200);
    assert.equal(meta.body.updateAvailable, true);
    assert.equal(meta.body.sha256, sha256);
    assert.equal(meta.body.file, undefined);
    const current = await request(app()).get('/api/app-updates?variant=agent&versionCode=12').set('x-test-role', 'agent').expect(200);
    assert.equal(current.body.updateAvailable, false);
    await request(app()).get('/api/app-updates/agent/download').set('x-test-role', 'agent').expect(200).expect('Content-Type', 'application/vnd.android.package-archive');
    await request(app('production')).get('/api/app-updates?variant=agent').set('x-test-role', 'agent').expect(503);
    await writeFile(path.join(directory, 'fixture.apk'), 'tampered fixture');
    await request(app()).get('/api/app-updates/agent/download').set('x-test-role', 'agent').expect(503);
    release.apps.agent.filename = '../outside.apk';
    await writeFile(path.join(directory, 'release.json'), JSON.stringify(release));
    await request(app()).get('/api/app-updates?variant=agent').set('x-test-role', 'agent').expect(503);
  } finally {
    // This exact path is produced by mkdtemp and remains under the operating-system temp directory.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
