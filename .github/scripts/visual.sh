#!/usr/bin/env bash
# Builds a PR's one visual from what implement recorded, on the evidence job's runner, with no agent present.
#
#   visual.sh <recorded dir> <output dir>
#
# The recorded dir holds `visual.json`, written by implement, and the files it names:
#
#   { "title": "What changed: …", "screens": [{ "caption": "Ingredients", "before": "1-before.png", "after": "1-after.png" },
#                                            { "caption": "The saved recipe", "after": "2-after.png" }] }
#   { "title": "Walkthrough: …", "video": "walkthrough.webm" }
#
# Screens become one collage (`visual.png`) of at most four pictures: each at phone width with its caption, a changed
# screen's before beside its after. A video becomes `walkthrough.mp4`, which plays on a phone, and `poster.png`: three
# of its frames with a play badge and its length. Prints what it made as JSON: { "title", "image", "video"?, "seconds"? }.
#
# Everything in visual.json is checked before use: the agent wrote it.
set -euo pipefail

in="$1"
out="$2"
manifest="$in/visual.json"

fail() {
  echo "::error::$1" >&2
  exit 1
}

[[ -f "$manifest" && ! -L "$manifest" ]] || fail 'visual.json is missing'
jq -e 'type == "object"' "$manifest" > /dev/null 2>&1 || fail 'visual.json is not a JSON object'

im() { if command -v magick > /dev/null; then magick "$@"; else convert "$@"; fi; }
size() { im "$1" -format '%w %h\n' info:; }

font=${VISUAL_FONT:-}
if [[ -z "$font" ]]; then
  for candidate in /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /System/Library/Fonts/HelveticaNeue.ttc; do
    [[ -f "$candidate" ]] && font=$candidate && break
  done
fi
[[ -n "$font" ]] || fail 'no font for the captions'

# Tastebook's dark ground, a hairline edge, and the caption colours.
bg='#120B22'
edge='#3A2F55'
text='#EDE7F6'
muted='#A99BC4'
accent='#8EE0B0'

title=$(jq -r '.title // empty' "$manifest" | tr -d '\000-\037')
[[ -n "$title" ]] || fail 'visual.json has no title'
title=${title:0:150}

# A file visual.json names: plain, lower case, of the given kind, and a regular file in the recorded dir.
recorded() {
  local name="$1" kind="$2"
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]{0,62}\.$kind$ ]] || fail "$name is not a named .$kind file"
  [[ -f "$in/$name" && ! -L "$in/$name" ]] || fail "$name is not a regular file"
  (( $(wc -c < "$in/$name") <= 50000000 )) || fail "$name is over 50 MB"
  printf '%s' "$in/$name"
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# One screen at phone width with rounded corners and a hairline edge: screen <src> <dest>. A taller capture keeps its top.
screen() {
  im "$1" -resize '375x' -background "$bg" -gravity north -extent 375x812 \
    \( -size 375x812 xc:black -fill white -draw 'roundrectangle 0,0 374,811 22,22' \) \
    -alpha off -compose CopyOpacity -composite \
    -compose over -background "$bg" -gravity center -extent 379x816 \
    -fill none -stroke "$edge" -strokewidth 2 -draw 'roundrectangle 2,2 376,813 22,22' \
    +repage "$2"
}

# A screen with a label above it: labelled <src> <label> <colour> <dest>. The label is passed as text, never read as a
# file name, and checked before it gets here.
labelled() {
  screen "$1" "$4"
  im "$4" -background "$bg" -gravity north -splice 0x46 \
    -font "$font" -pointsize 21 -fill "$3" -annotate +0+8 "$2" +repage "$4"
}

# Side by side with a gap: row <gap> <dest> <images…>
row() {
  local gap="$1" dest="$2"
  shift 2
  im -background "$bg" -gravity center "$@" +smush "$gap" +repage "$dest"
}

# Plain ASCII, so the check doesn't depend on the runner's locale; short enough that ", before" still fits. A caption
# outside it is tidied rather than refused, so one odd character never costs the whole visual: anything else becomes a
# space, it starts at a letter or digit (never `@`, which ImageMagick reads as a file) and it's cut to length.
caption_pattern="^[A-Za-z0-9][A-Za-z0-9 ,.:'()&/+-]{0,21}$"

tidy_caption() {
  local tidied
  tidied=$(printf '%s' "$1" | LC_ALL=C tr -c "A-Za-z0-9 ,.:'()&/+-" ' ' | LC_ALL=C sed -e 's/  */ /g' -e 's/^[^A-Za-z0-9]*//' \
    | cut -c1-22 | sed 's/ *$//')
  if [[ "$tidied" =~ $caption_pattern ]]; then printf '%s' "$tidied"; else printf 'Screen %s' "$2"; fi
}

collage() {
  local count
  count=$(jq '.screens | if type == "array" then length else -1 end' "$manifest")
  (( count >= 1 )) || fail 'visual.json has neither screens nor a video'
  local index
  # At most four pictures stay legible in Slack, a before counting as one. Past four, the screens from the first that
  # doesn't fit are left out, rather than the whole visual: implement puts the ones that matter most first. The first
  # screen always fits.
  local kept
  kept=$(jq '[.screens[] | if (.before // "") != "" then 2 else 1 end]
    | reduce .[] as $pictures ({total: 0, kept: 0, full: false};
        if .full or .total + $pictures > 4 then .full = true else .total += $pictures | .kept += 1 end)
    | .kept' "$manifest")
  if (( kept < count )); then
    local left_out=''
    for ((index = kept; index < count; index++)); do
      left_out+=", \"$(tidy_caption "$(jq -r ".screens[$index].caption // empty" "$manifest")" "$((index + 1))")\""
    done
    echo "::warning::A collage holds at most 4 pictures, a before counting as one: it leaves out ${left_out#, }" >&2
    count=$kept
  fi
  local pairs
  pairs=$(jq --argjson kept "$kept" '[.screens[:$kept][] | select((.before // "") != "")] | length' "$manifest")
  local groups=()
  for ((index = 0; index < count; index++)); do
    local caption after before
    caption=$(tidy_caption "$(jq -r ".screens[$index].caption // empty" "$manifest")" "$((index + 1))")
    after=$(recorded "$(jq -r ".screens[$index].after // empty" "$manifest")" png)
    before=$(jq -r ".screens[$index].before // empty" "$manifest")
    if [[ -n "$before" ]]; then
      before=$(recorded "$before" png)
      labelled "$before" "$caption, before" "$muted" "$work/$index-before.png"
      labelled "$after" "$caption, after" "$accent" "$work/$index-after.png"
      row 24 "$work/$index.png" "$work/$index-before.png" "$work/$index-after.png"
    else
      labelled "$after" "$caption" "$text" "$work/$index.png"
    fi
    groups+=("$work/$index.png")
  done
  # A before and after pair stands apart from what's next to it.
  if (( pairs > 0 && count > 1 )); then
    im -size 2x862 xc:"$edge" "$work/divider.png"
    local spaced=("${groups[0]}")
    for ((index = 1; index < count; index++)); do spaced+=("$work/divider.png" "${groups[$index]}"); done
    row 40 "$work/row.png" "${spaced[@]}"
  else
    row 32 "$work/row.png" "${groups[@]}"
  fi
  im "$work/row.png" -bordercolor "$bg" -border 40 -background "$bg" -flatten "$out/visual.png"
  jq -n --arg title "$title" '{title: $title, image: "visual.png"}'
}

video() {
  local source seconds
  source=$(recorded "$(jq -r '.video' "$manifest")" webm)
  ffmpeg -nostdin -loglevel error -y -i "$source" -an -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p \
    -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' -movflags +faststart "$out/walkthrough.mp4" \
    || fail "the video couldn't be converted to mp4"
  seconds=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/walkthrough.mp4")
  [[ "$seconds" =~ ^[0-9]+(\.[0-9]+)?$ ]] || fail "the video's length couldn't be read"
  # Three frames, from early, middle and late in the walk.
  local frames=() at
  for at in 0.15 0.5 0.85; do
    local frame="$work/frame-$at.png"
    ffmpeg -nostdin -loglevel error -y -ss "$(awk -v s="$seconds" -v f="$at" 'BEGIN { printf "%.2f", s * f }')" \
      -i "$out/walkthrough.mp4" -frames:v 1 "$frame" || fail "couldn't take a frame from the video"
    screen "$frame" "$work/screen-$at.png"
    frames+=("$work/screen-$at.png")
  done
  row 24 "$work/strip.png" "${frames[@]}"
  im "$work/strip.png" -bordercolor "$bg" -border 40 -background "$bg" -flatten "$work/strip.png"
  local w h cx cy whole length
  read -r w h < <(size "$work/strip.png")
  cx=$((w / 2))
  cy=$((h / 2))
  whole=$(awk -v s="$seconds" 'BEGIN { printf "%d", s + 0.5 }')
  length=$(printf '%d:%02d' $((whole / 60)) $((whole % 60)))
  im "$work/strip.png" \
    -fill 'rgba(18,11,34,0.35)' -draw "rectangle 0,0 $w,$h" \
    -fill 'rgba(255,255,255,0.95)' -draw "circle $cx,$cy $((cx + 60)),$cy" \
    -fill "$bg" -draw "polygon $((cx - 18)),$((cy - 30)) $((cx - 18)),$((cy + 30)) $((cx + 32)),$cy" \
    -fill 'rgba(0,0,0,0.75)' -draw "roundrectangle $((w - 140)),$((h - 92)) $((w - 56)),$((h - 52)) 10,10" \
    -font "$font" -pointsize 24 -fill white -gravity southeast -annotate +70+60 "$length" \
    "$out/poster.png"
  jq -n --arg title "$title" --argjson seconds "$whole" \
    '{title: $title, image: "poster.png", video: "walkthrough.mp4", seconds: $seconds}'
}

if jq -e 'has("video")' "$manifest" > /dev/null; then
  video
else
  collage
fi
