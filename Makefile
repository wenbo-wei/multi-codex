SHELL := /bin/bash

UUID := multi-codex@wenbo
EXTENSION_DIR := extension
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(UUID).shell-extension.zip

NODE_TESTS := \
	tests/test_workspace_layout.mjs \
	tests/test_workspace_window_placement.mjs \
	tests/test_workspace_window_set.mjs

EXTRA_SOURCES := \
	workspaceLayout.mjs \
	workspaceLayoutCli.mjs \
	workspaceWindowPlacement.mjs \
	workspaceWindowSet.mjs \
	scripts

PACK_FLAGS := $(foreach source,$(EXTRA_SOURCES),--extra-source=$(source))

.PHONY: test package smoke integration verify clean

test:
	bash -n \
		extension/scripts/multi-codex \
		extension/scripts/open-six-terminals \
		harness/run-headless.sh \
		harness/run-production-smoke.sh \
		tools/check-package.sh
	node --test $(NODE_TESTS)
	PYTHONDONTWRITEBYTECODE=1 \
		python3 -m unittest discover -s tests -p 'test_*.py' -v

package: test
	mkdir -p "$(DIST_DIR)"
	gnome-extensions pack \
		--force \
		--out-dir="$(abspath $(DIST_DIR))" \
		$(PACK_FLAGS) \
		"$(EXTENSION_DIR)"
	tools/check-package.sh "$(PACKAGE)"

smoke:
	harness/run-production-smoke.sh

integration:
	harness/run-headless.sh fix

verify: package smoke

clean:
	rm -f -- "$(PACKAGE)"
	rmdir --ignore-fail-on-non-empty "$(DIST_DIR)"
