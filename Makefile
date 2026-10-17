.DEFAULT_GOAL := help

.PHONY: help test check fmt fmt-check

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

test: ## Run the vitest suite
	npm test

check: ## Typecheck and check formatting
	npm run check

fmt: ## Format files and sync skill references
	bash scripts/maint/sync-references.sh
	dprint fmt

fmt-check: ## Check formatting and skill reference sync
	bash scripts/maint/sync-references.sh --check
	dprint check
