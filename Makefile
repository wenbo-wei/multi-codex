SHELL := /bin/bash

UUID := multi-codex@wenbo
DIST_DIR := dist
PACKAGE := $(DIST_DIR)/$(UUID).shell-extension.zip

.PHONY: package clean

package:
	mkdir -p "$(DIST_DIR)"
	tools/package.sh "$(abspath $(DIST_DIR))"

clean:
	rm -f -- "$(PACKAGE)"
	rmdir --ignore-fail-on-non-empty "$(DIST_DIR)"
