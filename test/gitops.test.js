'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

test('required GitOps files exist', () => {
  const required = [
    'gitops/bootstrap/project.yaml',
    'gitops/bootstrap/root-application.yaml',
    'gitops/applications/reservations-dev.yaml',
    'gitops/applications/reservations-staging.yaml',
    'gitops/applications/reservations-prod.yaml',
    'gitops/apps/reservations/base/kustomization.yaml',
    'gitops/apps/reservations/base/rollout.yaml',
    'gitops/apps/reservations/base/analysis/success-rate.yaml',
    'gitops/apps/reservations/base/analysis/latency-p99.yaml',
    'gitops/apps/reservations/base/analysis/error-budget.yaml',
    'gitops/apps/reservations/overlays/dev/kustomization.yaml',
    'gitops/apps/reservations/overlays/staging/kustomization.yaml',
    'gitops/apps/reservations/overlays/prod/kustomization.yaml',
  ];
  for (const rel of required) {
    assert.ok(exists(rel), `missing ${rel}`);
  }
});

test('root Application is an app-of-apps pointing at gitops/applications', () => {
  const rootApp = read('gitops/bootstrap/root-application.yaml');
  assert.match(rootApp, /kind:\s*Application/);
  assert.match(rootApp, /name:\s*gitops-root/);
  assert.match(rootApp, /path:\s*gitops\/applications/);
  assert.match(rootApp, /project:\s*reservations-platform/);
  assert.match(rootApp, /repoURL:\s*https:\/\/github.com\/shubhamkhedkar\/gitops-platform-argocd.git/);
  assert.match(rootApp, /targetRevision:\s*main/);
  assert.match(rootApp, /selfHeal:\s*true/);
});

test('AppProject allows the three environment namespaces', () => {
  const project = read('gitops/bootstrap/project.yaml');
  assert.match(project, /kind:\s*AppProject/);
  assert.match(project, /name:\s*reservations-platform/);
  for (const ns of ['reservations-dev', 'reservations-staging', 'reservations-prod', 'argocd']) {
    assert.match(project, new RegExp(`namespace:\\s*${ns}`));
  }
});

test('child Applications point at overlay paths that exist', () => {
  const expected = {
    'gitops/applications/reservations-dev.yaml': {
      name: 'reservations-dev',
      ns: 'reservations-dev',
      path: 'gitops/apps/reservations/overlays/dev',
    },
    'gitops/applications/reservations-staging.yaml': {
      name: 'reservations-staging',
      ns: 'reservations-staging',
      path: 'gitops/apps/reservations/overlays/staging',
    },
    'gitops/applications/reservations-prod.yaml': {
      name: 'reservations-prod',
      ns: 'reservations-prod',
      path: 'gitops/apps/reservations/overlays/prod',
    },
  };
  for (const [file, spec] of Object.entries(expected)) {
    const text = read(file);
    assert.match(text, new RegExp(`name:\\s*${spec.name}`));
    assert.match(text, new RegExp(`namespace:\\s*${spec.ns}`));
    assert.match(text, new RegExp(`path:\\s*${spec.path}`));
    assert.ok(exists(path.join(spec.path, 'kustomization.yaml')), spec.path);
  }
});

test('base Rollout uses a canary strategy with stable and canary services', () => {
  const rollout = read('gitops/apps/reservations/base/rollout.yaml');
  assert.match(rollout, /kind:\s*Rollout/);
  assert.match(rollout, /canary:/);
  assert.match(rollout, /stableService:\s*reservations-api-stable/);
  assert.match(rollout, /canaryService:\s*reservations-api-canary/);
  assert.match(rollout, /path:\s*\/healthz/);
  assert.match(rollout, /path:\s*\/readyz/);
  assert.match(rollout, /path:\s*\/startupz/);
  assert.match(rollout, /runAsNonRoot:\s*true/);
  assert.match(rollout, /readOnlyRootFilesystem:\s*true/);
});

test('analysis templates query Prometheus for success rate, latency and error ratio', () => {
  const success = read('gitops/apps/reservations/base/analysis/success-rate.yaml');
  const latency = read('gitops/apps/reservations/base/analysis/latency-p99.yaml');
  const errors = read('gitops/apps/reservations/base/analysis/error-budget.yaml');
  assert.match(success, /kind:\s*AnalysisTemplate/);
  assert.match(success, /provider:\s*\n\s*prometheus:/);
  assert.match(success, /http_requests_total/);
  assert.match(success, /code!~"5\.\."/);
  assert.match(latency, /histogram_quantile/);
  assert.match(latency, /http_request_duration_seconds_bucket/);
  assert.match(errors, /code=~"5\.\."/);
  assert.match(success, /clamp_min/);
});

test('dev canary is lightweight and does not wait on Prometheus analysis', () => {
  const patch = read('gitops/apps/reservations/overlays/dev/rollout-patch.yaml');
  assert.match(patch, /path:\s*\/spec\/replicas/);
  assert.match(patch, /value:\s*1/);
  assert.match(patch, /setWeight:\s*50/);
  assert.match(patch, /duration:\s*30s/);
  assert.doesNotMatch(patch, /templateName:/);
  assert.doesNotMatch(patch, /analysis:/);
});

test('staging canary analyses success rate before continuing', () => {
  const patch = read('gitops/apps/reservations/overlays/staging/rollout-patch.yaml');
  assert.match(patch, /path:\s*\/spec\/replicas/);
  assert.match(patch, /value:\s*2/);
  assert.match(patch, /setWeight:\s*25/);
  assert.match(patch, /setWeight:\s*50/);
  assert.match(patch, /templateName:\s*success-rate/);
  assert.match(patch, /value:\s*reservations-staging/);
});

test('prod canary uses 20/50/80 weights and all three Prometheus checks', () => {
  const patch = read('gitops/apps/reservations/overlays/prod/rollout-patch.yaml');
  assert.match(patch, /path:\s*\/spec\/replicas/);
  assert.match(patch, /value:\s*4/);
  assert.match(patch, /setWeight:\s*20/);
  assert.match(patch, /setWeight:\s*50/);
  assert.match(patch, /setWeight:\s*80/);
  assert.match(patch, /templateName:\s*success-rate/);
  assert.match(patch, /templateName:\s*latency-p99/);
  assert.match(patch, /templateName:\s*error-budget/);
  assert.match(patch, /DoNotSchedule/);
  assert.match(patch, /podAntiAffinity:/);
  const kustomization = read('gitops/apps/reservations/overlays/prod/kustomization.yaml');
  assert.match(kustomization, /ghcr.io\/shubhamkhedkar\/reservations-api/);
});

test('example Secret uses a placeholder rather than a live credential', () => {
  const secret = read('gitops/apps/reservations/base/secret.yaml');
  assert.match(secret, /example-api-key-change-me/);
  assert.match(secret, /Example values only/i);
});

test('repository does not contain private keys or cloud access tokens', () => {
  const files = walk(ROOT).filter((file) => !file.includes(`${path.sep}.git${path.sep}`));
  const forbidden = [
    /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/,
    /AKIA[0-9A-Z]{16}/,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
});

test('kustomize overlays keep container image, probes and hashed ConfigMap refs', () => {
  const { spawnSync } = require('node:child_process');
  for (const overlay of ['dev', 'staging', 'prod']) {
    const result = spawnSync(
      'kustomize',
      ['build', path.join(ROOT, 'gitops/apps/reservations/overlays', overlay)],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const out = result.stdout;
    assert.match(out, /kind: Rollout/);
    assert.match(out, /containerPort: 8080/);
    assert.match(out, /path: \/healthz/);
    assert.match(out, /path: \/readyz/);
    assert.match(out, /path: \/startupz/);
    assert.match(out, /configMapRef:/);
    assert.match(out, /name: reservations-api-config-/);
    assert.match(out, /envFrom:/);
    assert.match(out, /image: /);
    if (overlay === 'prod') {
      assert.match(out, /image: ghcr.io\/shubhamkhedkar\/reservations-api:1.0.0/);
      assert.match(out, /setWeight: 20/);
    }
    if (overlay === 'dev') {
      assert.match(out, /image: reservations-api:1.0.0/);
      assert.match(out, /APP_ENV: dev/);
    }
  }
});
