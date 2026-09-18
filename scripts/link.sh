#!/usr/bin/env bash
DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p ~/.pi/agent/skills
ln -sfn "$DOTFILES_DIR/.pi/agent/skills/brave-search" ~/.pi/agent/skills/brave-search

mkdir -p ~/.pi/agent/extensions
ln -sfn "$DOTFILES_DIR/.pi/agent/extensions/compact-mode.ts" ~/.pi/agent/extensions/compact-mode.ts

