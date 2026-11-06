/** Release validation records and packaging. This script never starts the application. */
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const mode = process.argv[2];
const fail = (message) => { throw new Error(message); };
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const required = (name) => process.env[name] || fail(`${name} is required`);
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const hashFile = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const saveJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

if (mode === 'prepare') {
  const ref = required('GITHUB_REF');
  const { version } = await json('package.json');
  if (!semver.test(version) || ref !== `refs/tags/v${version}`) {
    fail(`Release must run from refs/tags/v${version}; received ${ref}. Select the version tag when running manually.`);
  }
  const lock = await json('package-lock.json');
  if (lock.version !== version || lock.packages[''].version !== version) fail('package-lock.json version does not match package.json');
  const commit = git('rev-parse', 'HEAD');
  if (commit !== git('rev-parse', `${ref}^{commit}`)) fail('Checkout does not match the release tag');
  const image = `ghcr.io/${required('GITHUB_REPOSITORY_OWNER').toLowerCase()}/aipic`;
  await appendFile(required('GITHUB_OUTPUT'), `version=${version}\ntag=v${version}\ncommit=${commit}\nimage=${image}\n`);
  console.log(`Releasing v${version} from ${commit} as ${image}`);
} else {
  const version = required('RELEASE_VERSION');
  const tag = required('RELEASE_TAG');
  const commit = required('RELEASE_COMMIT');
  const image = required('RELEASE_IMAGE');
  const dir = required('RELEASE_DIR');
  if (!semver.test(version) || tag !== `v${version}` || !/^[a-f0-9]{40}$/.test(commit)) fail('Invalid release version, tag or commit');
  if (git('rev-parse', 'HEAD') !== commit || (await json('package.json')).version !== version) fail('Release metadata does not match the checked-out source');
  await mkdir(dir, { recursive: true });

  const readImages = async () => {
    const records = await Promise.all(['amd64', 'arm64'].map((arch) => json(join(dir, `image-${arch}.json`))));
    for (const [index, record] of records.entries()) {
      const arch = ['amd64', 'arm64'][index];
      if (record.version !== version || record.commit !== commit || record.image !== image || record.platform !== `linux/${arch}` || !digestPattern.test(record.digest)) fail(`Unexpected ${arch} image metadata`);
      if (record.file !== `aipic-${version}-linux-${arch}.tar.gz`) fail(`Unexpected ${arch} archive name`);
      if (await hashFile(join(dir, record.file)) !== record.sha256) fail(`${record.file} checksum mismatch`);
    }
    return records;
  };

  const readValidation = async () => {
    const validation = await json(join(dir, 'validation.json'));
    if (validation.version !== version || validation.commit !== commit || validation.productionBuild !== true
      || !(validation.unitTestsPassed > 0) || !(validation.uiChecksPassed > 0)
      || validation.pageErrors !== 0 || validation.liveModelRequests !== 0) fail('Missing or mismatched release validation');
    return validation;
  };

  if (mode === 'validate') {
    const unit = await json(process.argv[3]);
    const ui = await json(process.argv[4]);
    const build = await json('dist/version.json');
    if (!unit.success || unit.numFailedTests !== 0 || unit.numPassedTests <= 0 || unit.numPassedTests !== unit.numTotalTests) fail('Unit tests did not all pass');
    if (!(ui.passed > 0) || ui.passed !== ui.checks?.length || ui.pageErrors?.length !== 0 || ui.liveModelRequests !== 0) fail('UI regression checks did not all pass');
    if (build.version !== version || !build.buildId?.startsWith(`${version}-`)) fail('Production frontend version mismatch');
    await saveJson(join(dir, 'validation.json'), {
      version, commit, productionBuild: true, validatedBuildId: build.buildId,
      unitTestFiles: unit.testResults.length, unitTestsPassed: unit.numPassedTests,
      uiChecksPassed: ui.passed, pageErrors: 0, liveModelRequests: 0,
      scope: 'Unit tests and production frontend UI regression with intercepted model requests; application containers are not started by this workflow.',
    });
    console.log(`Validated ${unit.numPassedTests} unit tests and ${ui.passed} UI checks for ${commit}`);
  } else if (mode === 'image') {
    const arch = required('RELEASE_ARCH');
    const digest = required('RELEASE_DIGEST');
    if (!['amd64', 'arm64'].includes(arch) || !digestPattern.test(digest)) fail('Invalid image architecture or digest');
    const archive = process.argv[3];
    const extract = (entry) => execFileSync('tar', ['-xOf', archive, entry], { maxBuffer: 8 * 1024 * 1024 });
    const manifest = JSON.parse(extract('manifest.json'));
    const expectedTags = [`aipic:${version}`, `docker.io/library/aipic:${version}`];
    if (manifest.length !== 1 || !manifest[0].RepoTags?.some((name) => expectedTags.includes(name))) fail('Archive does not contain the expected versioned Docker image');
    const configBytes = extract(manifest[0].Config);
    const config = JSON.parse(configBytes);
    const configDigest = `sha256:${createHash('sha256').update(configBytes).digest('hex')}`;
    const registry = await json(process.argv[4]);
    if (registry.config?.digest !== configDigest) fail('Registry image and downloadable archive have different image configs');
    if (config.os !== 'linux' || config.architecture !== arch) fail('Image architecture mismatch');
    if (config.config?.Labels?.['org.opencontainers.image.version'] !== version || config.config?.Labels?.['org.opencontainers.image.revision'] !== commit) fail('Image version or commit label mismatch');
    const file = `aipic-${version}-linux-${arch}.tar.gz`;
    await pipeline(createReadStream(archive), createGzip({ level: 6 }), createWriteStream(join(dir, file)));
    await saveJson(join(dir, `image-${arch}.json`), {
      version, commit, image, platform: `linux/${arch}`, digest, configDigest, file,
      sha256: await hashFile(join(dir, file)), bytes: (await stat(join(dir, file))).size,
    });
    console.log(`Packaged ${file} (${digest})`);
  } else if (mode === 'sources') {
    for (const record of await readImages()) console.log(`${image}@${record.digest}`);
  } else if (mode === 'assemble') {
    const images = await readImages();
    const validation = await readValidation();
    const releaseNotes = await readFile(`docs/releases/${tag}.md`, 'utf8');
    const manifest = await json(process.argv[3]);
    if (manifest.manifests?.length !== 2) fail('Registry manifest must contain exactly two architectures');
    for (const record of images) {
      const arch = record.platform.split('/')[1];
      if (!manifest.manifests.some((entry) => entry.digest === record.digest && entry.platform?.os === 'linux' && entry.platform?.architecture === arch)) fail(`Multi-platform manifest is missing ${record.platform}`);
    }
    const registryDigest = manifest.digest;
    if (!digestPattern.test(registryDigest)) fail('Missing multi-platform registry digest');
    const sourceName = `aipic-${version}-source.tar.gz`;
    const source = spawn('git', ['archive', '--format=tar', `--prefix=aipic-${version}/`, commit], { stdio: ['ignore', 'pipe', 'inherit'] });
    const sourceExit = once(source, 'close');
    await pipeline(source.stdout, createGzip({ level: 6 }), createWriteStream(join(dir, sourceName)));
    const [status] = await sourceExit;
    if (status !== 0) fail(`git archive failed (${status})`);

    // Derive deployment settings from this commit, removing only the local build section.
    let compose = git('show', `${commit}:docker-compose.yml`);
    const buildBlock = /^    build:\n(?:      .*\n)+/m;
    if (!buildBlock.test(compose)) fail('Cannot find the source Compose build section');
    compose = compose.replace(buildBlock, '');
    if (!/^    image:.*$/m.test(compose)) fail('Cannot find the source Compose image');
    compose = compose.replace(/^    image:.*$/m, `    image: "\${AIPIC_IMAGE:-aipic:${version}}"`);
    await writeFile(join(dir, 'docker-compose.yml'), `${compose}\n`);
    await writeFile(join(dir, 'README.md'), `# AIPic ${version}\n\n版本：\`${tag}\`；源码提交：\`${commit}\`。\n\n${releaseNotes.trim()}\n\n## 安装与校验\n\n下载 \`docker-compose.yml\` 和与服务器匹配的镜像包。Intel/AMD 使用 amd64；ARM/Apple Silicon 使用 arm64。\n\n\`\`\`sh\ndocker load -i aipic-${version}-linux-amd64.tar.gz\ndocker compose up -d\n\`\`\`\n\nARM64 请将文件名中的 amd64 换为 arm64。两个镜像包均加载为 \`aipic:${version}\`。打开 http://localhost:8080/，在页面配置 API 地址、密钥和模型。数据保存在 \`aipic-data\` 卷中。\n\n也可直接使用 GHCR 多架构镜像：\n\n\`\`\`sh\nAIPIC_IMAGE=${image}:${version} docker compose up -d\n\`\`\`\n\n固定镜像摘要：\`${image}@${registryDigest}\`。源码包为 \`${sourceName}\`。下载全部附件后可执行 \`sha256sum -c SHA256SUMS\` 核对文件完整性。\n\n生产站点 https://image.simplaj.top/ 由 Cloudflare Pages 从 main 自动部署，保留同源 /api-proxy；Cloudflare Pages 不运行 Node 后台任务队列。需要持久化后台队列时使用本 Docker 部署。可选 GitHub Pages 只提供静态前端，需要支持浏览器 CORS 的上游 API。\n\n## 发布验证\n\n本次提交通过 ${validation.unitTestsPassed} 项单测、生产构建和 ${validation.uiChecksPassed} 项浏览器检查，浏览器运行错误为 0，真实模型调用为 0。详见 \`validation.json\`。镜像归档与 registry 的配置摘要、两种架构、版本和源码提交均经核对；此发布工作流没有启动应用容器。\n`);
    for (const arch of ['amd64', 'arm64']) await rm(join(dir, `image-${arch}.json`));
    const files = [];
    for (const name of (await readdir(dir)).sort()) {
      if (!/^(aipic-[\d.]+-(linux-(amd64|arm64)|source)\.tar\.gz|docker-compose\.yml|README\.md|validation\.json)$/.test(name)) fail(`Unexpected release asset: ${name}`);
      files.push({ name, bytes: (await stat(join(dir, name))).size, sha256: await hashFile(join(dir, name)) });
    }
    await saveJson(join(dir, 'release.json'), {
      version, tag, commit, image: `aipic:${version}`, registryImage: `${image}:${version}`, registryDigest,
      platforms: images.map((record) => record.platform), images,
      source: { archive: sourceName, commit },
      workflowRun: `${required('GITHUB_SERVER_URL')}/${required('GITHUB_REPOSITORY')}/actions/runs/${required('GITHUB_RUN_ID')}`,
      testsRun: true, validation, containersStarted: false, files,
    });
    const sums = [];
    for (const name of (await readdir(dir)).sort()) sums.push(`${await hashFile(join(dir, name))}  ${name}`);
    await writeFile(join(dir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
    console.log(`Prepared ${sums.length + 1} release assets for ${tag} (${commit})`);
  } else if (mode === 'latest') {
    const releases = (await json(process.argv[3])).flat();
    const current = version.split('.').map(Number);
    const newer = releases.some((release) => {
      if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) return false;
      const parts = release.tag_name.slice(1).split('.').map(Number);
      for (let index = 0; index < 3; index += 1) {
        if (parts[index] !== current[index]) return parts[index] > current[index];
      }
      return false;
    });
    console.log(String(!newer));
  } else {
    fail(`Unknown release packaging command: ${mode}`);
  }
}
