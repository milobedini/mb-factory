#!/usr/bin/env bash
# Tests for visual.sh: a collage, the screens it leaves out past four pictures, a video and its poster, and the
# manifests it must refuse. Needs ImageMagick and ffmpeg,
# as the evidence job installs them; skips without them.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
failed=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failed=1; }

if ! { command -v magick > /dev/null || command -v convert > /dev/null; } || ! command -v ffmpeg > /dev/null; then
  echo 'visual: skipped (needs ImageMagick and ffmpeg)'
  exit 0
fi
im() { if command -v magick > /dev/null; then magick "$@"; else convert "$@"; fi; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rec="$work/rec"
mkdir -p "$rec"
for name in 1-before 1-after 2-after 3-after; do im -size 375x812 xc:'#2B2140' "$rec/$name.png"; done
# A full-page capture, taller than a phone screen: it keeps its top.
im -size 375x1600 xc:'#2B2140' "$rec/4-after.png"
ffmpeg -nostdin -loglevel error -f lavfi -i testsrc=size=375x812:rate=25:duration=6 -c:v libvpx -b:v 200k "$rec/walkthrough.webm"

build() { bash "$here/visual.sh" "$rec" "$work/out" 2> "$work/err"; }
dims() { im "$1" -format '%wx%h' info:; }

echo 'visual'
jq -n '{title: "What changed: Ingredients, the saved recipe",
  screens: [{caption: "Ingredients section", before: "1-before.png", after: "1-after.png"}, {caption: "The saved recipe", after: "2-after.png"}]}' > "$rec/visual.json"
if made=$(build) && [[ $(jq -r .image <<< "$made") == visual.png && $(jq -r .title <<< "$made") == 'What changed: Ingredients, the saved recipe' ]]; then
  pass "a pair and a new screen make one collage ($(dims "$work/out/visual.png"))"
else
  fail "collage: $(cat "$work/err")"
fi

rm -rf "$work/out"
jq -n '{title: "Three new screens", screens: [{caption: "One", after: "2-after.png"}, {caption: "Two", after: "3-after.png"}, {caption: "Tall", after: "4-after.png"}]}' > "$rec/visual.json"
if build > /dev/null && [[ $(dims "$work/out/visual.png") == 1281x942 ]]; then
  pass 'new screens sit side by side at phone height, a tall capture cut to its top'
else
  fail "new screens: $(dims "$work/out/visual.png" 2> /dev/null) $(cat "$work/err")"
fi

# Past four pictures, a before counting as one, the screens from the first that doesn't fit are left out, and the
# warning names them; the collage is the one the screens that fit would make.
trimmed() {
  local name="$1" all="$2" fits="$3" left_out="$4"
  rm -rf "$work/out" "$work/fits"
  printf '%s' "$fits" > "$rec/visual.json"
  bash "$here/visual.sh" "$rec" "$work/fits" > /dev/null 2>&1
  printf '%s' "$all" > "$rec/visual.json"
  if build > /dev/null && [[ $(dims "$work/out/visual.png") == $(dims "$work/fits/visual.png") ]] \
    && grep -qF "::warning::A collage holds at most 4 pictures, a before counting as one: it leaves out $left_out" "$work/err"; then
    pass "leaves out $name ($(dims "$work/out/visual.png"))"
  else
    fail "should leave out $name: $(dims "$work/out/visual.png" 2> /dev/null) $(cat "$work/err")"
  fi
}
trimmed 'the last of three new screens after a pair' \
  '{"title": "T", "screens": [{"caption": "Lists", "before": "1-before.png", "after": "1-after.png"}, {"caption": "New list", "after": "2-after.png"}, {"caption": "A household list", "after": "3-after.png"}, {"caption": "Rename list", "after": "4-after.png"}]}' \
  '{"title": "T", "screens": [{"caption": "Lists", "before": "1-before.png", "after": "1-after.png"}, {"caption": "New list", "after": "2-after.png"}, {"caption": "A household list", "after": "3-after.png"}]}' \
  '"Rename list"'
trimmed 'a pair that would make five, and everything after it' \
  '{"title": "T", "screens": [{"caption": "A", "before": "1-before.png", "after": "1-after.png"}, {"caption": "B", "after": "2-after.png"}, {"caption": "C", "before": "1-before.png", "after": "3-after.png"}, {"caption": "D", "after": "4-after.png"}]}' \
  '{"title": "T", "screens": [{"caption": "A", "before": "1-before.png", "after": "1-after.png"}, {"caption": "B", "after": "2-after.png"}]}' \
  '"C", "D"'

rm -rf "$work/out"
jq -n '{title: "T", screens: [{caption: "A", before: "1-before.png", after: "1-after.png"}, {caption: "B", before: "1-before.png", after: "2-after.png"}]}' > "$rec/visual.json"
if build > /dev/null && ! grep -q 'leaves out' "$work/err"; then
  pass 'two pairs fill the collage and leave nothing out'
else
  fail "two pairs: $(cat "$work/err")"
fi

rm -rf "$work/out"
jq -n '{title: "Walkthrough: adding an ingredient", video: "walkthrough.webm"}' > "$rec/visual.json"
if made=$(build) && [[ $(jq -c '[.image, .video, .seconds]' <<< "$made") == '["poster.png","walkthrough.mp4",6]' ]] \
  && [[ -s "$work/out/walkthrough.mp4" && -s "$work/out/poster.png" ]]; then
  pass "a video becomes an mp4 and a poster of three frames ($(dims "$work/out/poster.png"))"
else
  fail "video: $(cat "$work/err")"
fi

refused() {
  rm -rf "$work/out"
  printf '%s' "$2" > "$rec/visual.json"
  if build > /dev/null; then fail "should refuse: $1"; else pass "refuses $1"; fi
}
# An odd caption is tidied, never refused: one character shouldn't cost the whole visual.
tidied() {
  rm -rf "$work/out"
  jq -n --arg caption "$2" '{title: "T", screens: [{caption: $caption, after: "2-after.png"}]}' > "$rec/visual.json"
  if build > /dev/null; then pass "tidies $1"; else fail "should tidy $1: $(cat "$work/err")"; fi
}
tidied 'a colon' 'Privacy: your choices'
tidied 'a caption read as a file' '@/etc/passwd'
tidied 'a long caption' 'A caption far too long to fit'
tidied 'curly quotes and a percent sign' '“Saved” 100% ✓'
tidied 'nothing usable' '✓✓✓'

refused 'no title' '{"screens": [{"caption": "One", "after": "2-after.png"}]}'
refused 'neither screens nor a video' '{"title": "Nothing"}'
refused 'a path outside the folder' '{"title": "T", "screens": [{"caption": "One", "after": "../2-after.png"}]}'
refused 'a missing file' '{"title": "T", "screens": [{"caption": "One", "after": "9-after.png"}]}'
refused 'a video that is not webm' '{"title": "T", "video": "2-after.png"}'
ln -s "$rec/2-after.png" "$rec/5-after.png"
refused 'a symlink' '{"title": "T", "screens": [{"caption": "One", "after": "5-after.png"}]}'

exit "$failed"
