#!/bin/bash
set -euo pipefail

# ─── ANSI Helpers (Standard 16-color palette only) ───────────────────────────
R="\033[0m"         # Reset
B="\033[1m"         # Bold
D="\033[2m"         # Dim
I="\033[3m"         # Italic

# Foreground accents (Standard 16 colors)
FG_BLACK="\033[30m"
FG_RED="\033[31m"
FG_GREEN="\033[32m"
FG_YELLOW="\033[33m"
FG_BLUE="\033[34m"
FG_MAGENTA="\033[35m"
FG_CYAN="\033[36m"
FG_WHITE="\033[37m"

FG_GRAY="\033[90m"
FG_BRIGHT_RED="\033[91m"
FG_BRIGHT_GREEN="\033[92m"
FG_BRIGHT_YELLOW="\033[93m"
FG_BRIGHT_BLUE="\033[94m"
FG_BRIGHT_MAGENTA="\033[95m"
FG_BRIGHT_CYAN="\033[96m"
FG_BRIGHT_WHITE="\033[97m"

# Number Highlight Color
NUM_COLOR="${FG_BRIGHT_WHITE}${B}"

# Separators
DOT="${FG_GRAY} · ${R}"

# ─── Parse JSON from stdin (Single jq pass for performance) ──────────────────
# Extract all fields in one pass to prevent spawning jq 8 times.
{
  read -r STATE
  read -r USED_PCT
  read -r VCS_BRANCH
  read -r VCS_DIRTY
  read -r SANDBOX
  read -r ARTIFACTS
  read -r SUBAGENTS
  read -r BG_TASKS
  read -r MODEL
  read -r COLS
  read -r CWD
  read -r CYCLE_MODE
  read -r Q_GEMINI_5H
  read -r Q_GEMINI_WEEKLY
  read -r R_GEMINI_5H
  read -r R_GEMINI_WEEKLY
} < <(
  jq -r '
    (.agent_state // "idle"),
    (.context_window.used_percentage // 0),
    (.vcs.branch // ""),
    (.vcs.dirty // false),
    (.sandbox.enabled // false),
    (.artifact_count // 0),
    (if .subagents | type == "array" then (.subagents | length) else 0 end),
    (.task_count // 0),
    (.model.display_name // ""),
    (.terminal_width // 80),
    (.cwd // ""),
    (.cycle_mode // ""),
    (if .quota."gemini-5h".remaining_fraction != null then (.quota."gemini-5h".remaining_fraction * 100 | round) else "" end),
    (if .quota."gemini-weekly".remaining_fraction != null then (.quota."gemini-weekly".remaining_fraction * 100 | round) else "" end),
    (.quota."gemini-5h".reset_in_seconds // ""),
    (.quota."gemini-weekly".reset_in_seconds // "")
  ' 2>/dev/null || printf "idle\n0\n\nfalse\nfalse\n0\n0\n0\n\n80\n\n\n\n\n\n\n"
)

# ─── Computed Values ─────────────────────────────────────────────────────────
# Use LC_NUMERIC=C to prevent bash printf errors in locales that use commas for decimals
PCT_FMT=$(LC_NUMERIC=C printf "%.1f" "$USED_PCT")
PCT_INT=${USED_PCT%.*}; PCT_INT=${PCT_INT:-0}

# ─── Model ───────────────────────────────────────────────────────────────────
M=""
if [ -n "$MODEL" ]; then
  M="${FG_BRIGHT_MAGENTA}${I}${MODEL}${R}"
fi

# ─── CWD ─────────────────────────────────────────────────────────────────────
C=""
if [ -n "$CWD" ]; then
  HOME_DIR="${HOME:-/home/dtserver}"
  CWD_DISPLAY="${CWD/#$HOME_DIR/\~}"
  if [ -n "$M" ]; then
    C="${DOT}${FG_CYAN}${CWD_DISPLAY}${R}"
  else
    C="${FG_CYAN}${CWD_DISPLAY}${R}"
  fi
fi

# ─── VCS Branch ──────────────────────────────────────────────────────────────
V=""
if [ -z "$VCS_BRANCH" ] && [ -n "$CWD" ] && [ -d "$CWD" ]; then
  VCS_BRANCH=$(git --no-optional-locks -C "$CWD" branch --show-current 2>/dev/null || git --no-optional-locks -C "$CWD" rev-parse --short HEAD 2>/dev/null || true)
  if [ -n "$VCS_BRANCH" ] && [ "$VCS_DIRTY" != "true" ]; then
    if [ -n "$(git --no-optional-locks -C "$CWD" status --porcelain 2>/dev/null)" ]; then
      VCS_DIRTY="true"
    fi
  fi
fi

if [ -n "$VCS_BRANCH" ]; then
  if [ "$VCS_DIRTY" = "true" ]; then
    V=" ${FG_GRAY}(${FG_BRIGHT_RED}${VCS_BRANCH}${FG_BRIGHT_YELLOW}*${FG_GRAY})${R}"
  else
    V=" ${FG_GRAY}(${FG_BRIGHT_BLUE}${VCS_BRANCH}${FG_GRAY})${R}"
  fi
fi

# ─── Cycle Mode ──────────────────────────────────────────────────────────────
CY=""
if [ -n "$CYCLE_MODE" ]; then
  CY="${FG_GRAY} ╱ ${FG_BRIGHT_BLUE}${CYCLE_MODE}${R}"
fi

# ─── Sandbox Badge ───────────────────────────────────────────────────────────
SB=""
if [ "$SANDBOX" = "true" ]; then
  SB="${FG_GRAY}sandbox ${FG_BRIGHT_GREEN}${B}ON${R}"
fi

# ─── Context Percentage Color ────────────────────────────────────────────────
if [ "$PCT_INT" -ge 90 ]; then
  PCT_COLOR="${FG_BRIGHT_RED}${B}"
elif [ "$PCT_INT" -ge 60 ]; then
  PCT_COLOR="${FG_BRIGHT_YELLOW}${B}"
else
  PCT_COLOR="${FG_BRIGHT_WHITE}${B}"
fi

# ─── Stats ───────────────────────────────────────────────────────────────────
CTX="${FG_GRAY}ctx ${PCT_COLOR}${PCT_FMT}%${R}"
ART_FMT="${FG_GRAY}artifacts ${NUM_COLOR}${ARTIFACTS}${R}"
SUB_FMT="${FG_GRAY}subagents ${NUM_COLOR}${SUBAGENTS}${R}"
BG_FMT="${FG_GRAY}tasks ${NUM_COLOR}${BG_TASKS}${R}"

# ─── Separators ──────────────────────────────────────────────────────────────
DOT="${FG_GRAY} · ${R}"

# ─── Quotas ──────────────────────────────────────────────────────────────────
get_quota_color() {
  local val="$1"
  if [ -z "$val" ]; then
    echo -ne "${FG_GRAY}"
  elif [ "$val" -lt 20 ]; then
    echo -ne "${FG_BRIGHT_RED}${B}"
  elif [ "$val" -lt 50 ]; then
    echo -ne "${FG_BRIGHT_YELLOW}${B}"
  else
    echo -ne "${NUM_COLOR}"
  fi
}

format_duration() {
  local sec="$1"
  if [ -z "$sec" ] || [ "$sec" -le 0 ]; then
    echo -ne "0s"
    return
  fi
  if [ "$sec" -lt 60 ]; then
    echo -ne "${sec}s"
  elif [ "$sec" -lt 3600 ]; then
    echo -ne "$(( sec / 60 ))m"
  elif [ "$sec" -lt 86400 ]; then
    local hrs=$(( sec / 3600 ))
    local mins=$(( (sec % 3600) / 60 ))
    if [ "$mins" -eq 0 ]; then
      echo -ne "${hrs}h"
    else
      echo -ne "${hrs}h${mins}m"
    fi
  else
    local days=$(( sec / 86400 ))
    local hrs=$(( (sec % 86400) / 3600 ))
    if [ "$hrs" -eq 0 ]; then
      echo -ne "${days}d"
    else
      echo -ne "${days}d${hrs}h"
    fi
  fi
}

format_quota() {
  local name="$1"
  local pct="$2"
  local r_sec="$3"
  
  local col
  col=$(get_quota_color "$pct")
  
  local reset_str=""
  if [ -n "$r_sec" ]; then
    local dur
    dur=$(format_duration "$r_sec")
    reset_str=" (⏳${dur})"
  fi
  
  echo -ne "${FG_GRAY}${name} ${col}${pct}%${reset_str}${R}"
}

Q_GEMINI_5H_FMT=""
if [ -n "$Q_GEMINI_5H" ]; then
  Q_GEMINI_5H_FMT=$(format_quota "5h" "$Q_GEMINI_5H" "$R_GEMINI_5H")
fi

Q_GEMINI_WEEKLY_FMT=""
if [ -n "$Q_GEMINI_WEEKLY" ]; then
  Q_GEMINI_WEEKLY_FMT=$(format_quota "wk" "$Q_GEMINI_WEEKLY" "$R_GEMINI_WEEKLY")
fi

# ─── Dynamic Priority Assembly ───────────────────────────────────────────────
strip_ansi() {
  echo -e "$1" | sed -r 's/\x1B\[[0-9;]*[a-zA-Z]//g'
}

# ── Line 1 Progressive Degradation
# 1. Full: Model + CWD + Branch + Cycle Mode
# 2. Drop Cycle Mode: Model + CWD + Branch
# 3. Drop CWD: Model + Branch
# 4. Drop Branch: Model only
C1="${M}${C}${V}${CY}"
C2="${M}${C}${V}"
C3="${M}${V}"
C4="${M}"

LINE1=""
for cand in "$C1" "$C2" "$C3" "$C4"; do
  [ -z "$cand" ] && continue
  clean=$(strip_ansi "$cand")
  if [ "${#clean}" -le "$COLS" ]; then
    LINE1="$cand"
    break
  fi
done
LINE1="${LINE1:-$M}"

# ── Line 2 Progressive Packing
LINE2=" ${CTX}"

append_if_fits() {
  local candidate="$1"
  [ -z "$candidate" ] && return
  local test_line="${LINE2}${DOT}${candidate}"
  local clean
  clean=$(strip_ansi "$test_line")
  if [ "${#clean}" -le "$COLS" ]; then
    LINE2="$test_line"
  fi
}

# Priority 1: Active Background Tasks
if [ "$BG_TASKS" -gt 0 ] 2>/dev/null; then
  append_if_fits "$BG_FMT"
fi

# Priority 2: Active Subagents
if [ "$SUBAGENTS" -gt 0 ] 2>/dev/null; then
  append_if_fits "$SUB_FMT"
fi

# Priority 3: Gemini 5-Hour Quota
if [ -n "$Q_GEMINI_5H_FMT" ]; then
  append_if_fits "$Q_GEMINI_5H_FMT"
fi

# Priority 4: Gemini Weekly Quota
if [ -n "$Q_GEMINI_WEEKLY_FMT" ]; then
  append_if_fits "$Q_GEMINI_WEEKLY_FMT"
fi

# Priority 5: Artifacts
if [ "$ARTIFACTS" -gt 0 ] 2>/dev/null; then
  append_if_fits "$ART_FMT"
fi

# Priority 6: Sandbox Badge
if [ -n "$SB" ]; then
  append_if_fits "$SB"
fi

echo -e "${LINE1}"
echo -e "${LINE2}"
