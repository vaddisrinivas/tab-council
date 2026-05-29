# Tab Council Demo Video

Framecraft source for the `v0.1.0-alpha` demo video.

Render from the repository root after installing Framecraft:

```bash
uv run --project /tmp/framecraft-tab-council python /tmp/framecraft-tab-council/framecraft.py render video/tab-council-demo/scenes.json --output dist/tab-council-demo.mp4
```

The release demo asset was rendered from HTML/CSS/Canvas scenes only. No screenshots were used.

The revised story narration lives in `story-narration.txt`. The current release audio was generated locally with Kokoro ONNX and mixed over the Framecraft-rendered video.
