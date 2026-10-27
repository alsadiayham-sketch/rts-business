const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rts-food-ui-'));
const env = { ...process.env, RTS_FIXTURE_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
try {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'restaurant-flow.cjs')], {
        stdio: 'inherit', windowsHide: true, timeout: 90000,
        env,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
} finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
