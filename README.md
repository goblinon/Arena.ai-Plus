# <img src="icons/arenaaiplus-icon.svg" width="28" align="top"> Arena.ai Plus

*Formerly known as LMArena Plus*

[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgoblinon%2FArena.ai-Plus%2Fmain%2Fmanifest.json&query=%24.version&label=version&color=blue)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/license-GPLv3-orange.svg)](LICENSE)

**Arena.ai Plus** is a Chrome Extension that helps you **save on API expenses** by enriching the [Arena.ai](https://arena.ai/leaderboard) leaderboards with real-time pricing data, a "Bang for Buck" value metric, and deeper model insights — giving you the context you need to pick the smartest model at the right price.

---

## Key Features

### <img src="icons/arenaaiplus-icon.svg" width="16" align="center"> Real-Time Pricing Integration
See what every model actually costs, right inside the leaderboard. Arena.ai Plus injects a **Pricing** column with fresh data from your choice of provider:
- **OpenRouter**
- **Helicone**
- **LiteLLM**

Switch providers or toggle token units (1M / 100K) from the extension popup.

### <img src="icons/arenaaiplus-icon.svg" width="16" align="center"> "Bang for Buck" Index
The core value metric — designed to surface the **smartest models for the lowest price**.
- Measures relative intelligence against cost using a logarithmic pricing curve.
- Applies a quality bonus to top-ranked models so elite-tier performance is weighted fairly.
- Helps you identify which models deliver the most intelligence per dollar.

### <img src="icons/arenaaiplus-icon.svg" width="16" align="center"> Deep Model Insights
- **Model Age** — See how many days since each model was released, so you can spot the newest contenders at a glance.
- **Context Window** — Instantly see the maximum token limit for every model.
- **Modalities** — Visual icons indicating support for Text, Image, Audio, or Video (both Input and Output).

### <img src="icons/arenaaiplus-icon.svg" width="16" align="center"> Generation Alerts
Get browser notifications when a generation completes:
- **Battle / Side-by-side mode** — Both models finish and voting is ready.
- **Direct chat** — Your model finishes generating.

Perfect for long code generations where you've switched to another tab.

### <img src="icons/arenaaiplus-icon.svg" width="16" align="center"> Seamless UI Integration
- **Light & Dark Mode** — All injected elements adapt automatically.
- **Smart Tooltips** — Detailed cost breakdowns (Input vs. Output) appear on hover.
- **Column Picker** — Toggle any column (native or Plus) on or off via the extension popup to keep your view clean and focused.
- **Native Sorting** — All injected columns are fully sortable, integrating with Arena.ai's table controls.

---

## Installation

### Chrome Web Store (Recommended)

[**Install Arena.ai Plus from the Chrome Web Store**](https://chromewebstore.google.com/detail/gialbmebogmajkfhacmigiiljejkjflm)

### Manual Installation

1. **Download** or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** and select the folder containing this project.
5. Visit [Arena](https://arena.ai/leaderboard) and enjoy!

---

## The "Bang for Buck" Logic

We believe that intelligence shouldn't always come at a premium. The algorithm calculates value by:
1. **Measuring Relative Intelligence** — Subtracting a baseline from the Arena Score.
2. **Scaling Cost** — Using a logarithmic curve so expensive models aren't unfairly penalized for minor price jumps.
3. **Weighting Quality** — Applying a gentle decay to lower ranks, ensuring a rank #1 model is valued higher than a rank #50 model even when their price/score ratio is similar.

---

## Contributing

Feel free to open issues or submit pull requests if you have ideas for new features or data sources!

## License

Distributed under the GPLv3 License. See `LICENSE` for more information.

---

*Note: This extension is not affiliated with Arena.ai or Chatbot Arena. Pricing data is fetched from public APIs of the respective providers.*
