.DEFAULT_GOAL := help

.PHONY: help test smoke tasks bank fmt fmt-check

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

tasks: ## Run parallel tasks test suite
	bash ./tests/tasks.sh

bank: ## Run knowledge-bank helper test suite
	bash ./tests/bank.sh

smoke: ## Run local smoke, tasks suite, bank suite, and remote smoke
	bash ./tests/smoke.sh
	bash ./tests/tasks.sh
	bash ./tests/bank.sh
	bash ./tests/smoke-remote.sh

test: smoke ## Run all tests

fmt: ## Format shell (shfmt via dprint exec) and markdown/yaml (dprint)
	dprint fmt
	bash scripts/maint/sync-bootstrap.sh
	bash scripts/maint/sync-references.sh

fmt-check: ## Check formatting without writing (requires dprint + shfmt on PATH)
	dprint check
	bash scripts/maint/sync-bootstrap.sh --check
	bash scripts/maint/sync-references.sh --check

