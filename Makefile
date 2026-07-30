SHELL := /bin/bash

PYTHON ?= python3
NODE ?= node
UUID := multi-codex@wenbo
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: check install uninstall package verify clean

check:
	$(PYTHON) -m json.tool extension/metadata.json >/dev/null
	$(NODE) --check extension/extension.js
	$(NODE) --check extension/workspaceLayout.mjs
	$(NODE) --check extension/workspaceLayoutCli.mjs
	$(NODE) --check extension/workspaceWindowPlacement.mjs
	$(NODE) --check extension/workspaceWindowSet.mjs
	$(NODE) --check scripts/extension-settings.mjs
	bash -n \
		extension/scripts/multi-codex \
		extension/scripts/open-six-terminals \
		scripts/install.sh \
		scripts/uninstall.sh \
		tools/package.sh \
		tools/verify-package.sh
	! grep -En \
		'codex-quota-centre@local|CODEX_SOURCE_INDICATOR_ID|/home/[^/]+/' \
		extension/extension.js extension/scripts/*

install:
	./scripts/install.sh

uninstall:
	./scripts/uninstall.sh

package:
	mkdir -p "$(DIST_DIR)"
	tools/package.sh "$(abspath $(DIST_DIR))"

verify: package
	tools/verify-package.sh "$(abspath $(PACKAGE))"

clean:
	rm -f -- "$(PACKAGE)"
	rmdir --ignore-fail-on-non-empty "$(DIST_DIR)"
