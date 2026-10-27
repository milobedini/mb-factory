# Slack assets

The custom emoji the factory's Slack cards and App Home use, shared by every project. Each project names them with its `slack.emojiPrefix` from `factory.yaml` (Tastebook: `tb`, so `:tb-done:`), since a workspace's emoji are global.

To make a project's set, render each SVG to a 128 px PNG named with the prefix, then upload them in Slack (Customize workspace → Emoji). Slack takes PNG, not SVG, and its API only adds emoji on Enterprise plans.

```sh
for f in slack-assets/emoji/*.svg; do rsvg-convert -w 128 -h 128 "$f" -o "projects/<name>/slack-assets/emoji/<prefix>-$(basename "$f" .svg).png"; done
```

`rsvg-convert` comes with `brew install librsvg`; ImageMagick's own SVG renderer drops the strokes. Each project's app icon lives in `projects/<name>/slack-assets/`.
