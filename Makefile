.DEFAULT_GOAL := help

.PHONY: help test smoke tasks distill status fmt fmt-check

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

tasks: ## Run parallel tasks test suite
	bash ./tests/tasks.sh

distill: ## Run atry distill (manifest export) test suite
	bash ./tests/distill.sh

status: ## Run human cockpit (status/approve/stamp/decide/close) test suite
	bash ./tests/status.sh

smoke: ## Run local smoke, tasks, distill, status, and remote smoke
	bash ./tests/smoke.sh
	bash ./tests/tasks.sh
	bash ./tests/distill.sh
	bash ./tests/status.sh
	bash ./tests/smoke-remote.sh

test: smoke ## Run all tests

fmt: ## Format shell (shfmt via dprint exec) and markdown/yaml (dprint)
	bash scripts/maint/sync-bootstrap.sh
	bash scripts/maint/sync-references.sh
	dprint fmt

fmt-check: ## Check formatting without writing (requires dprint + shfmt on PATH)
	bash scripts/maint/sync-bootstrap.sh --check
	bash scripts/maint/sync-references.sh --check
	dprint check
