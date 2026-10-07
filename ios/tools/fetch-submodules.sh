#!/usr/bin/env bash
# Amethyst-iOS keeps four dependencies as git submodules. ios/amethyst is vendored without .git, so CI fetches
# them at the exact commits the vendored upstream snapshot (Amethyst-iOS f98c413, 2026-10-04) pinned.
set -euo pipefail
cd "$(dirname "$0")/../amethyst/Natives/external"

fetch() { # dir url sha
  local dir="$1" url="$2" sha="$3"
  if [ -f "$dir/.vt-fetched-$sha" ]; then echo "[submodules] $dir already at $sha"; return; fi
  rm -rf "$dir"
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" fetch -q --depth 1 origin "$sha"
  git -C "$dir" checkout -q FETCH_HEAD
  git -C "$dir" submodule update --init --recursive --depth 1 || true
  rm -rf "$dir/.git"
  touch "$dir/.vt-fetched-$sha"
  echo "[submodules] $dir <- $url @ $sha"
}

fetch AFNetworking      https://github.com/AFNetworking/AFNetworking          d9f589cc2c1fe9d55eb5eea00558010afea7a41e
fetch DBNumberedSlider  https://github.com/khanhduytran0/DBNumberedSlider     4eddc68b5f92247f8afc0f6114d1b92b338749f4
fetch MobileGlues       https://github.com/MobileGL-Dev/MobileGlues           f0fb4d32794a130f4021342605a751ef2d0f84d8
fetch fishhook          https://github.com/khanhduytran0/fishhook            ab23646149fd8594545668754a1b7ded56a1b9af
