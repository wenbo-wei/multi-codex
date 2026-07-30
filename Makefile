SHELL := /bin/bash

UUID := multi-codex@wenbo
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(UUID).shell-extension.zip

NODE_TESTS := \
	tests/test_runtime_command.mjs \
	tests/test_workspace_layout.mjs \
	tests/test_workspace_window_placement.mjs \
	tests/test_workspace_window_set.mjs

.PHONY: test package smoke integration verify clean

test:
	bash -n \
		extension/scripts/multi-codex \
		extension/scripts/open-six-terminals \
		harness/run-headless.sh \
		harness/run-production-smoke.sh \
		tools/check-package.sh \
		tools/package.sh
	node --test $(NODE_TESTS)
	PYTHONDONTWRITEBYTECODE=1 \
		python3 -m unittest discover -s tests -p 'test_*.py' -v

package: test
	mkdir -p "$(DIST_DIR)"
	tools/package.sh "$(abspath $(DIST_DIR))"
	tools/check-package.sh "$(PACKAGE)"

smoke: package
	harness/run-production-smoke.sh "$(PACKAGE)"

integration:
	harness/run-headless.sh fix

verify: package smoke

clean:
	rm -f -- "$(PACKAGE)"
	rmdir --ignore-fail-on-non-empty "$(DIST_DIR)"
