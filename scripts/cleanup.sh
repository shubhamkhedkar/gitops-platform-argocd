#!/usr/bin/env bash
# Remove the demo Applications and destination namespaces from a cluster.
# Does not uninstall Argo CD, Argo Rollouts or Prometheus.
set -euo pipefail

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required" >&2
  exit 1
fi

for app in reservations-dev reservations-staging reservations-prod gitops-root; do
  kubectl -n argocd delete application "${app}" --ignore-not-found
done

kubectl -n argocd delete appproject reservations-platform --ignore-not-found

for ns in reservations-dev reservations-staging reservations-prod; do
  kubectl delete namespace "${ns}" --ignore-not-found
done

if [[ "${1:-}" == "--all" ]]; then
  kubectl delete namespace argocd --ignore-not-found
  kubectl delete namespace argo-rollouts --ignore-not-found
fi
