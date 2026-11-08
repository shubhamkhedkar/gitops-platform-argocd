#!/usr/bin/env bash
# Install Argo CD, Argo Rollouts and apply the app-of-apps root.
# Intended for you to run against a cluster you already control.
# This script is not executed as part of repository validation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARGOCD_NS="${ARGOCD_NS:-argocd}"
ROLLOUTS_NS="${ROLLOUTS_NS:-argo-rollouts}"

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

kubectl create namespace "${ARGOCD_NS}" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n "${ARGOCD_NS}" -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

kubectl create namespace "${ROLLOUTS_NS}" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -n "${ROLLOUTS_NS}" -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml

echo "Waiting for Argo CD server..."
kubectl -n "${ARGOCD_NS}" rollout status deploy/argocd-server --timeout=180s

kubectl apply -f "${ROOT_DIR}/gitops/bootstrap/project.yaml"
kubectl apply -f "${ROOT_DIR}/gitops/bootstrap/root-application.yaml"

echo "App-of-apps root applied. Point Argo CD at this repository if the cluster cannot reach GitHub yet."
