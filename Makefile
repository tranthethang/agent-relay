.DEFAULT_GOAL := help

.PHONY: help test smoke tasks

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

tasks: ## Run parallel tasks test suite
	bash ./tests/tasks.sh

smoke: ## Run local, task, and remote smoke tests
	bash ./tests/smoke.sh
	bash ./tests/tasks.sh
	bash ./tests/smoke-remote.sh

test: smoke ## Run all tests

