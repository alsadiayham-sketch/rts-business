const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed`);
  }
  return (result.stdout || '').trim();
}

function validateArtifacts() {
  const output = path.join(root, pkg.build?.directories?.output || 'dist');
  const artifactTemplate = pkg.build?.nsis?.artifactName;
  if (!artifactTemplate) throw new Error('build.nsis.artifactName is required');
  const artifactName = artifactTemplate
    .replace(/\$\{version\}/g, pkg.version)
    .replace(/\$\{ext\}/g, 'exe');
  if (artifactName.includes('${')) throw new Error(`Unsupported artifactName token: ${artifactName}`);

  const installer = path.join(output, artifactName);
  const blockmap = `${installer}.blockmap`;
  const latest = path.join(output, 'latest.yml');
  for (const file of [installer, blockmap, latest]) {
    if (!fs.existsSync(file)) throw new Error(`Missing release artifact: ${file}`);
  }

  const metadata = fs.readFileSync(latest, 'utf8');
  const version = metadata.match(/^version:\s*(.+)$/m)?.[1]?.trim();
  const releasePath = metadata.match(/^path:\s*(.+)$/m)?.[1]?.trim();
  const expectedHash = metadata.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
  const expectedSize = Number(metadata.match(/^\s+size:\s*(\d+)$/m)?.[1]);
  const actualHash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
  const actualSize = fs.statSync(installer).size;

  if (version !== pkg.version) throw new Error(`latest.yml version ${version} does not match package ${pkg.version}`);
  if (releasePath !== artifactName) throw new Error(`latest.yml path ${releasePath} does not match ${artifactName}`);
  if (expectedHash !== actualHash) throw new Error('Installer SHA-512 does not match latest.yml');
  if (expectedSize !== actualSize) throw new Error('Installer size does not match latest.yml');
  if (fs.statSync(blockmap).size === 0) throw new Error('Blockmap is empty');

  return { output, installer, blockmap, latest };
}

async function main() {
  const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish[0] : pkg.build?.publish;
  if (!publish || publish.provider !== 'github' || !publish.owner || !publish.repo) {
    throw new Error('A GitHub build.publish target is required');
  }

  const artifacts = validateArtifacts();
  let mode = option('--mode').toLowerCase();
  let notes = option('--notes');
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

  try {
    if (!['optional', 'mandatory'].includes(mode)) {
      if (!rl) throw new Error('Pass --mode optional or --mode mandatory');
      const answer = (await rl.question('Update type ([o]ptional/[m]andatory): ')).trim().toLowerCase();
      mode = answer === 'm' || answer === 'mandatory' ? 'mandatory' : 'optional';
    }
    if (!notes) {
      if (!rl) throw new Error('Pass --notes with the release notes');
      notes = (await rl.question('Release notes: ')).trim();
    }
    if (!notes) throw new Error('Release notes cannot be empty');
    if (mode === 'mandatory' && rl) {
      const confirmation = await rl.question('Type MANDATORY to block older clients until they update: ');
      if (confirmation !== 'MANDATORY') throw new Error('Mandatory release cancelled');
    }

    if (!args.includes('--dry-run')) {
      const status = run('git', ['status', '--porcelain'], { capture: true });
      if (status) throw new Error('Commit or stash tracked changes before publishing');
      const localHead = run('git', ['rev-parse', 'HEAD'], { capture: true });
      const upstreamHead = run('git', ['rev-parse', '@{u}'], { capture: true });
      if (localHead !== upstreamHead) throw new Error('Push the release commit before publishing');
    }

    const tag = `v${pkg.version}`;
    const title = `${pkg.build.productName} ${pkg.version}`;
    const notesFile = path.join(root, `.release-notes-${pkg.version}.md`);
    const body = `<!-- rts-update-policy ${JSON.stringify({ mode })} -->\n\n${notes}\n`;
    fs.writeFileSync(notesFile, body, { flag: 'wx' });
    try {
      const commandArgs = [
        'release', 'create', tag,
        artifacts.latest, artifacts.installer, artifacts.blockmap,
        '--repo', `${publish.owner}/${publish.repo}`,
        '--title', title,
        '--notes-file', notesFile
      ];
      if (args.includes('--dry-run')) {
        console.log(`Validated ${path.basename(artifacts.installer)}, latest.yml SHA-512, and blockmap.`);
        console.log(`Dry run: gh ${commandArgs.join(' ')}`);
      } else {
        run('gh', commandArgs);
      }
    } finally {
      fs.rmSync(notesFile, { force: true });
    }
  } finally {
    if (rl) rl.close();
  }
}

main().catch((error) => {
  console.error(`Release failed: ${error.message}`);
  process.exitCode = 1;
});
