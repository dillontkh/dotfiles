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
  read -r Q_3P_5H
  read -r Q_3P_WEEKLY
  read -r R_GEMINI_5H
  read -r R_GEMINI_WEEKLY
  read -r R_3P_5H
  read -r R_3P_WEEKLY
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
    (if .quota."3p-5h".remaining_fraction != null then (.quota."3p-5h".remaining_fraction * 100 | round) else "" end),
    (if .quota."3p-weekly".remaining_fraction != null then (.quota."3p-weekly".remaining_fraction * 100 | round) else "" end),
    (.quota."gemini-5h".reset_in_seconds // ""),
    (.quota."gemini-weekly".reset_in_seconds // ""),
    (.quota."3p-5h".reset_in_seconds // ""),
    (.quota."3p-weekly".reset_in_seconds // "")
  ' 2>/dev/null || printf "idle\n0\n\nfalse\nfalse\n0\n0\n0\n\n80\n\n\n\n\n\n\n\n\n\n\n"
)

# ─── Computed Values ─────────────────────────────────────────────────────────
# Use LC_NUMERIC=C to prevent bash printf errors in locales that use commas for decimals
PCT_FMT=$(LC_NUMERIC=C printf "%.1f" "$USED_PCT")
PCT_INT=${USED_PCT%.*}; PCT_INT=${PCT_INT:-0}

# ─── State Indicator (No background colors) ──────────────────────────────────
case "$STATE" in
  idle)     S="${FG_BRIGHT_GREEN}${B}● READY${R}" ;;
  thinking) S="${FG_BRIGHT_YELLOW}${B}◆ THINKING${R}" ;;
  working)  S="${FG_BRIGHT_CYAN}${B}⚙ WORKING${R}" ;;
  tool_use) S="${FG_BRIGHT_MAGENTA}${B}🔧 TOOL${R}" ;;
  *)        S="${FG_WHITE}${B}⏳ $(echo "$STATE" | tr '[:lower:]' '[:upper:]')${R}" ;;
esac

# ─── Model ───────────────────────────────────────────────────────────────────
M=""
if [ -n "$MODEL" ]; then
  M="${FG_GRAY} ╱ ${FG_BRIGHT_MAGENTA}${I}${MODEL}${R}"
fi

# ─── CWD ─────────────────────────────────────────────────────────────────────
C=""
if [ -n "$CWD" ]; then
  HOME_DIR="${HOME:-/home/dtserver}"
  CWD_DISPLAY="${CWD/#$HOME_DIR/\~}"
  C="${FG_GRAY} ╱ ${FG_CYAN}${CWD_DISPLAY}${R}"
fi

# ─── Cycle Mode ──────────────────────────────────────────────────────────────
CY=""
if [ -n "$CYCLE_MODE" ]; then
  CY="${FG_GRAY} ╱ ${FG_BRIGHT_BLUE}${CYCLE_MODE}${R}"
fi

# ─── VCS Branch ──────────────────────────────────────────────────────────────
V=""
if [ -n "$VCS_BRANCH" ]; then
  if [ "$VCS_DIRTY" = "true" ]; then
    V="${FG_GRAY} ╱ ${FG_BRIGHT_RED}${VCS_BRANCH}${FG_BRIGHT_YELLOW}*${R}"
  else
    V="${FG_GRAY} ╱ ${FG_BRIGHT_BLUE}${VCS_BRANCH}${R}"
  fi
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
  local period="$3"
  local r_sec="$4"
  
  local col
  col=$(get_quota_color "$pct")
  
  local reset_str=""
  if [ -n "$r_sec" ]; then
    local dur
    dur=$(format_duration "$r_sec")
    reset_str=" ⏳${dur}"
  fi
  
  echo -ne "${FG_GRAY}${name} ${col}${pct}% (${period}${reset_str})${R}"
}

Q_GEMINI=""
if [ -n "$Q_GEMINI_5H" ] || [ -n "$Q_GEMINI_WEEKLY" ]; then
  if [ -n "$Q_GEMINI_5H" ] && [ -n "$Q_GEMINI_WEEKLY" ]; then
    if [ "$Q_GEMINI_5H" -le "$Q_GEMINI_WEEKLY" ]; then
      Q_GEMINI=$(format_quota "gemini" "$Q_GEMINI_5H" "5h" "$R_GEMINI_5H")
    else
      Q_GEMINI=$(format_quota "gemini" "$Q_GEMINI_WEEKLY" "wk" "$R_GEMINI_WEEKLY")
    fi
  elif [ -n "$Q_GEMINI_5H" ]; then
    Q_GEMINI=$(format_quota "gemini" "$Q_GEMINI_5H" "5h" "$R_GEMINI_5H")
  elif [ -n "$Q_GEMINI_WEEKLY" ]; then
    Q_GEMINI=$(format_quota "gemini" "$Q_GEMINI_WEEKLY" "wk" "$R_GEMINI_WEEKLY")
  fi
fi

Q_3P=""
if [ -n "$Q_3P_5H" ] || [ -n "$Q_3P_WEEKLY" ]; then
  if [ -n "$Q_3P_5H" ] && [ -n "$Q_3P_WEEKLY" ]; then
    if [ "$Q_3P_5H" -le "$Q_3P_WEEKLY" ]; then
      Q_3P=$(format_quota "3p" "$Q_3P_5H" "5h" "$R_3P_5H")
    else
      Q_3P=$(format_quota "3p" "$Q_3P_WEEKLY" "wk" "$R_3P_WEEKLY")
    fi
  elif [ -n "$Q_3P_5H" ]; then
    Q_3P=$(format_quota "3p" "$Q_3P_5H" "5h" "$R_3P_5H")
  elif [ -n "$Q_3P_WEEKLY" ]; then
    Q_3P=$(format_quota "3p" "$Q_3P_WEEKLY" "wk" "$R_3P_WEEKLY")
  fi
fi

Q_FMT=""
if [ -n "$Q_GEMINI" ]; then
  Q_FMT="${Q_GEMINI}"
fi
if [ -n "$Q_3P" ]; then
  if [ -n "$Q_FMT" ]; then
    Q_FMT="${Q_FMT}${DOT}${Q_3P}"
  else
    Q_FMT="${Q_3P}"
  fi
fi

# ─── Output ──────────────────────────────────────────────────────────────────
LINE1="${S}${M}${C}${CY}${V}"
LINE2=" ${CTX}"

if [ "$ARTIFACTS" -gt 0 ] 2>/dev/null; then
  LINE2="${LINE2}${DOT}${ART_FMT}"
fi

if [ "$SUBAGENTS" -gt 0 ] 2>/dev/null; then
  LINE2="${LINE2}${DOT}${SUB_FMT}"
fi

if [ "$BG_TASKS" -gt 0 ] 2>/dev/null; then
  LINE2="${LINE2}${DOT}${BG_FMT}"
fi

if [ -n "$SB" ]; then
  LINE2="${LINE2}${DOT}${SB}"
fi

if [ -n "$Q_FMT" ]; then
  LINE2="${LINE2}${DOT}${Q_FMT}"
fi

if [ "$COLS" -ge 80 ]; then
  # Wide / Medium: two lines
  echo -e "${LINE1}"
  echo -e "${LINE2}"
else
  # Narrow: compact two-line, minimal chrome
  echo -e "${S}${M}"
  if [ "$BG_TASKS" -gt 0 ] 2>/dev/null; then
    echo -e "${CTX}${DOT}${BG_FMT}"
  else
    echo -e "${CTX}"
  fi
fi
