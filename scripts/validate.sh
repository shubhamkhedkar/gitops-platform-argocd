#!/usr/bin/env bash
# Offline validation: unit tests, Kustomize render, CRD schema checks.
# Needs no cluster, no Argo CD, and no Prometheus.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_VERSION="${K8S_VERSION:-1.30.0}"
CRD_SCHEMA='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'

kubeconform_opts=(
  -strict
  -summary
  -ignore-missing-schemas=false
  -kubernetes-version "${K8S_VERSION}"
  -schema-location default
  -schema-location "${CRD_SCHEMA}"
)

echo "== Unit tests (reservations-api)"
(cd "${ROOT_DIR}/app" && npm test)

echo "== GitOps structure tests"
(cd "${ROOT_DIR}" && node --test test/*.test.js)

if ! command -v kustomize >/dev/null 2>&1; then
  echo "kustomize is required for manifest validation" >&2
  exit 1
fi
if ! command -v kubeconform >/dev/null 2>&1; then
  echo "kubeconform is required for manifest validation" >&2
  exit 1
fi

for target in base overlays/dev overlays/staging overlays/prod; do
  echo "== kustomize build gitops/apps/reservations/${target} | kubeconform"
  kustomize build "${ROOT_DIR}/gitops/apps/reservations/${target}" \
    | kubeconform "${kubeconform_opts[@]}" -
done

echo "== kubeconform gitops/bootstrap and gitops/applications"
kubeconform "${kubeconform_opts[@]}" \
  "${ROOT_DIR}/gitops/bootstrap/"*.yaml \
  "${ROOT_DIR}/gitops/applications/"*.yaml

if command -v shellcheck >/dev/null 2>&1; then
  echo "== shellcheck"
  shellcheck "${ROOT_DIR}"/scripts/*.sh
fi

if command -v hadolint >/dev/null 2>&1; then
  echo "== hadolint"
  hadolint "${ROOT_DIR}/app/Dockerfile"
fi

echo "All checks passed."
