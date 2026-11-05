#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
swiftc -module-cache-path build/.swift-module-cache native/updater/main.swift -o build/aegir-updater-proof
AEGIR_UPDATER_HELPER="$PWD/build/aegir-updater-proof" python3 scripts/updater-proof.test.py
