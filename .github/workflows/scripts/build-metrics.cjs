#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ARTIFACT_NAME_PATTERN = /^build-metrics-([0-9a-f]{8})\.json$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] =
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : 'true';
  }
  return args;
}

function asInteger(value, name, { min = Number.MIN_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return number;
}

function asBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return Boolean(value);
}

function normalizeSha(value, name = 'sha') {
  const sha = String(value || '').toLowerCase();
  if (!FULL_SHA_PATTERN.test(sha)) {
    throw new Error(`${name} must be a 40-character git SHA`);
  }
  return sha;
}

function artifactNameForSha(sha) {
  return `build-metrics-${normalizeSha(sha).slice(0, 8)}.json`;
}

function getArtifactSha8(name) {
  const match = String(name || '').match(ARTIFACT_NAME_PATTERN);
  return match ? match[1] : null;
}

function sortNewestFirst(artifacts) {
  return [...artifacts].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || '');
    const rightTime = Date.parse(right.created_at || '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }
    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function isMainArtifact(artifact) {
  return artifact?.workflow_run?.head_branch === 'main';
}

function selectExactArtifacts(artifacts, baseSha) {
  const exactName = artifactNameForSha(baseSha);
  return sortNewestFirst(
    artifacts.filter(
      (artifact) =>
        artifact?.name === exactName &&
        artifact.expired !== true &&
        isMainArtifact(artifact),
    ),
  );
}

function selectFallbackArtifacts(artifacts) {
  return sortNewestFirst(
    artifacts.filter(
      (artifact) =>
        getArtifactSha8(artifact?.name) &&
        artifact.expired !== true &&
        isMainArtifact(artifact),
    ),
  );
}

function validateMetricsPayload(payload, { artifact, expectedSha } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'metrics payload is not an object' };
  }

  if (payload.schema !== 1) {
    return { valid: false, reason: 'unsupported metrics schema' };
  }

  if (payload.metric !== 'next-build') {
    return { valid: false, reason: 'unsupported metrics type' };
  }

  const sha = String(payload.sha || '').toLowerCase();
  if (!FULL_SHA_PATTERN.test(sha)) {
    return { valid: false, reason: 'metrics sha is invalid' };
  }

  if (expectedSha && sha !== normalizeSha(expectedSha, 'expectedSha')) {
    return { valid: false, reason: 'metrics sha does not match PR base sha' };
  }

  const sha8 = String(payload.sha8 || '').toLowerCase();
  if (sha8 !== sha.slice(0, 8)) {
    return { valid: false, reason: 'metrics sha8 does not match sha' };
  }

  const artifactSha8 = getArtifactSha8(artifact?.name);
  if (artifactSha8 && artifactSha8 !== sha8) {
    return { valid: false, reason: 'artifact name does not match metrics sha' };
  }

  if (payload.ref !== 'refs/heads/main') {
    return { valid: false, reason: 'metrics ref is not main' };
  }

  const artifactHeadSha = artifact?.workflow_run?.head_sha;
  if (artifactHeadSha && String(artifactHeadSha).toLowerCase() !== sha) {
    return {
      valid: false,
      reason: 'artifact workflow sha does not match metrics sha',
    };
  }

  const sizeBytes = Number(payload.size_bytes);
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, reason: 'metrics size_bytes is invalid' };
  }

  const durationSeconds = Number(payload.duration_seconds);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    return { valid: false, reason: 'metrics duration_seconds is invalid' };
  }

  return {
    valid: true,
    metrics: {
      ...payload,
      sha,
      sha8,
      size_bytes: sizeBytes,
      duration_seconds: durationSeconds,
    },
  };
}

function resolveBaselineFromArtifacts({
  baseSha,
  exactArtifacts = [],
  fallbackArtifacts = [],
  loadMetrics,
}) {
  if (typeof loadMetrics !== 'function') {
    throw new Error('loadMetrics callback is required');
  }

  const normalizedBaseSha = normalizeSha(baseSha, 'baseSha');
  const failures = [];

  for (const artifact of selectExactArtifacts(
    exactArtifacts,
    normalizedBaseSha,
  )) {
    const loaded = loadMetrics(artifact);
    if (loaded?.error) {
      failures.push(`${artifact.name}: ${loaded.error}`);
      continue;
    }

    const validation = validateMetricsPayload(loaded.payload, {
      artifact,
      expectedSha: normalizedBaseSha,
    });
    if (validation.valid) {
      return {
        found: true,
        source: 'exact-base-sha',
        artifact,
        metrics: validation.metrics,
        failures,
      };
    }
    failures.push(`${artifact.name}: ${validation.reason}`);
  }

  for (const artifact of selectFallbackArtifacts(fallbackArtifacts)) {
    const loaded = loadMetrics(artifact);
    if (loaded?.error) {
      failures.push(`${artifact.name}: ${loaded.error}`);
      continue;
    }

    const validation = validateMetricsPayload(loaded.payload, { artifact });
    if (validation.valid) {
      return {
        found: true,
        source: 'latest-main',
        artifact,
        metrics: validation.metrics,
        failures,
      };
    }
    failures.push(`${artifact.name}: ${validation.reason}`);
  }

  return {
    found: false,
    source: 'none',
    reason: failures.length
      ? `No valid build metrics artifact found (${failures.join('; ')})`
      : 'No build metrics artifact found',
    failures,
  };
}

function runGhJson(args) {
  const output = childProcess.execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output || '{}');
}

function listRepositoryArtifacts({ repo, name }) {
  const args = [
    'api',
    '-X',
    'GET',
    `/repos/${repo}/actions/artifacts`,
    '-f',
    'per_page=100',
  ];
  if (name) {
    args.push('-f', `name=${name}`);
  }

  const response = runGhJson(args);
  return Array.isArray(response.artifacts) ? response.artifacts : [];
}

function downloadMetricsArtifact({ repo, artifact, downloadRoot }) {
  const runId = artifact?.workflow_run?.id;
  if (!runId) {
    return { error: 'artifact has no workflow run id' };
  }

  const targetDir = path.join(
    downloadRoot,
    `${runId}-${artifact.id || artifact.name}`,
  );
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  try {
    childProcess.execFileSync(
      'gh',
      [
        'run',
        'download',
        String(runId),
        '-n',
        artifact.name,
        '-D',
        targetDir,
        '-R',
        repo,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    return { error: error.message };
  }

  const metricsFile = path.join(targetDir, artifact.name);
  try {
    return {
      payload: JSON.parse(fs.readFileSync(metricsFile, 'utf8')),
      filePath: metricsFile,
    };
  } catch (error) {
    return { error: error.message };
  }
}

function resolveBaseline({ repo, baseSha, downloadRoot }) {
  const exactName = artifactNameForSha(baseSha);
  const exactArtifacts = listRepositoryArtifacts({ repo, name: exactName });
  const exactResult = resolveBaselineFromArtifacts({
    baseSha,
    exactArtifacts,
    loadMetrics: (artifact) =>
      downloadMetricsArtifact({ repo, artifact, downloadRoot }),
  });

  if (exactResult.found) {
    return exactResult;
  }

  const fallbackArtifacts = listRepositoryArtifacts({ repo });
  const fallbackResult = resolveBaselineFromArtifacts({
    baseSha,
    fallbackArtifacts,
    loadMetrics: (artifact) =>
      downloadMetricsArtifact({ repo, artifact, downloadRoot }),
  });
  const failures = [...exactResult.failures, ...fallbackResult.failures];

  return {
    ...fallbackResult,
    failures,
    reason: fallbackResult.found
      ? fallbackResult.reason
      : failures.length
        ? `No valid build metrics artifact found (${failures.join('; ')})`
        : fallbackResult.reason || exactResult.reason,
  };
}

function buildMetricsPayload({
  sha,
  ref,
  runId,
  runAttempt,
  serverUrl,
  repository,
  sizeBytes,
  durationSeconds,
  runnerOs,
  runnerArch,
  nextCacheEnabled,
  createdAt = new Date().toISOString(),
}) {
  const normalizedSha = normalizeSha(sha);
  const numericRunId = asInteger(runId, 'runId', { min: 1 });
  if (!serverUrl) {
    throw new Error('serverUrl is required');
  }
  if (!repository) {
    throw new Error('repository is required');
  }
  return {
    schema: 1,
    metric: 'next-build',
    sha: normalizedSha,
    sha8: normalizedSha.slice(0, 8),
    ref,
    run_id: numericRunId,
    run_attempt: asInteger(runAttempt, 'runAttempt', { min: 1 }),
    run_url: `${serverUrl}/${repository}/actions/runs/${numericRunId}`,
    created_at: createdAt,
    size_bytes: asInteger(sizeBytes, 'sizeBytes', { min: 1 }),
    duration_seconds: asInteger(durationSeconds, 'durationSeconds', {
      min: 0,
    }),
    runner_os: runnerOs,
    runner_arch: runnerArch,
    next_cache_enabled: asBoolean(nextCacheEnabled),
  };
}

function writeMetricsFile({ outputDir, payload }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const artifactName = artifactNameForSha(payload.sha);
  const metricsFile = path.join(outputDir, artifactName);
  fs.writeFileSync(metricsFile, `${JSON.stringify(payload, null, 2)}\n`);
  return { artifactName, metricsFile };
}

function writeGithubOutputs(outputs, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = Object.entries(outputs).map(
    ([key, value]) => `${key}=${String(value ?? '').replace(/[\r\n]+/g, ' ')}`,
  );
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

function writeCommand(args) {
  const payload = buildMetricsPayload({
    sha: args.sha || process.env.GITHUB_SHA,
    ref: args.ref || process.env.GITHUB_REF,
    runId: args.runId || process.env.GITHUB_RUN_ID,
    runAttempt: args.runAttempt || process.env.GITHUB_RUN_ATTEMPT || '1',
    serverUrl: args.serverUrl || process.env.GITHUB_SERVER_URL,
    repository: args.repository || process.env.GITHUB_REPOSITORY,
    sizeBytes: args.sizeBytes,
    durationSeconds: args.durationSeconds,
    runnerOs: args.runnerOs || process.env.RUNNER_OS,
    runnerArch: args.runnerArch || process.env.RUNNER_ARCH,
    nextCacheEnabled: args.nextCacheEnabled,
  });
  const { artifactName, metricsFile } = writeMetricsFile({
    outputDir: args.outputDir || '.',
    payload,
  });

  writeGithubOutputs(
    {
      artifact_name: artifactName,
      metrics_file: metricsFile,
      size: payload.size_bytes,
      duration: payload.duration_seconds,
    },
    args.githubOutput,
  );
  process.stdout.write(`Wrote ${metricsFile}\n`);
}

function baselineCommand(args) {
  const repo = args.repo || process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('--repo or GITHUB_REPOSITORY is required');
  }
  const baseSha = normalizeSha(args.baseSha, 'baseSha');
  const downloadRoot =
    args.downloadDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'build-metrics-baseline-'));
  fs.mkdirSync(downloadRoot, { recursive: true });

  const result = resolveBaseline({ repo, baseSha, downloadRoot });
  if (!result.found) {
    writeGithubOutputs(
      {
        baseline_found: 'false',
        baseline_source: 'none',
        baseline_reason: result.reason,
        main_size: '',
        main_duration: '',
        main_sha: '',
        main_run_url: '',
      },
      args.githubOutput,
    );
    process.stdout.write(`${result.reason}\n`);
    return;
  }

  writeGithubOutputs(
    {
      baseline_found: 'true',
      baseline_source: result.source,
      baseline_artifact_name: result.artifact.name,
      baseline_created_at: result.metrics.created_at,
      main_size: result.metrics.size_bytes,
      main_duration: result.metrics.duration_seconds,
      main_sha: result.metrics.sha,
      main_run_url: result.metrics.run_url,
    },
    args.githubOutput,
  );
  process.stdout.write(
    `Using ${result.artifact.name} from ${result.metrics.sha}\n`,
  );
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (command === 'write') {
    writeCommand(args);
    return;
  }

  if (command === 'baseline') {
    baselineCommand(args);
    return;
  }

  throw new Error('Usage: build-metrics.cjs <write|baseline> [options]');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  ARTIFACT_NAME_PATTERN,
  artifactNameForSha,
  buildMetricsPayload,
  getArtifactSha8,
  resolveBaselineFromArtifacts,
  selectExactArtifacts,
  selectFallbackArtifacts,
  validateMetricsPayload,
  writeMetricsFile,
};
