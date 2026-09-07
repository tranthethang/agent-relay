.DEFAULT_GOAL := help

.PHONY: help format test smoke

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

format: ## Format Markdown files with mdformat
	uv run mdformat README.md docs/ examples/ skills/

smoke: ## Run local and remote smoke tests
	bash ./tests/smoke.sh
	bash ./tests/smoke-remote.sh

test: smoke ## Run all tests
