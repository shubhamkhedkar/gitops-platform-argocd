.PHONY: test validate render-dev render-staging render-prod bootstrap clean

test:
	cd app && npm test
	node --test test/*.test.js

validate:
	./scripts/validate.sh

render-dev:
	kustomize build gitops/apps/reservations/overlays/dev

render-staging:
	kustomize build gitops/apps/reservations/overlays/staging

render-prod:
	kustomize build gitops/apps/reservations/overlays/prod

bootstrap:
	./scripts/bootstrap.sh

clean:
	./scripts/cleanup.sh
