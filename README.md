# LMArena Plus

[![Version](https://img.shields.io/badge/version-1.4.2-blue.svg)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/license-GPLv3-orange.svg)](LICENSE)

**LMArena Plus** is a powerful Chrome Extension that enhances the [LMArena (Chatbot Arena)](https://chat.lmsys.org/?leaderboard) leaderboard with real-time pricing data, specialized value metrics, and deeper model insights.

---

## ✨ Key Features

### 💰 Real-Time Pricing Integration
Stop guessing what your favorite models cost. LMArena Plus injects a "Pricing" column directly into the leaderboard, pulling fresh data from top providers:
- **OpenRouter**
- **Helicone**
- **LiteLLM**

*Switch providers or toggle token units (1M, 100K, 1K) seamlessly via the extension popup.*

### 🚀 "Bang for Buck" Index
Our specialized value metric helps you find the "sweet spot" of intelligence vs. cost. 
- **The Concept**: It finds the smartest models for the lowest price.
- **Why it matters**: It rewards high-intelligence models that stay affordable, while applying a "quality bonus" to top-ranked models to ensure you're getting elite-tier performance for your dollar.

### 🧠 Deep Model Insights
- **Context Window**: Instantly see the maximum token limit for every model.
- **Modalities**: Visual icons indicating which models support Text, Image, Audio, or Video (both Input and Output).
- **Native Sorting**: All injected columns (Pricing, Value, Context) are fully sortable, integrating perfectly with LMArena's native table controls.

### 🎨 Seamless UI Integration
LMArena Plus is designed to feel like a native part of the site. It supports:
- **Light & Dark Mode**: Modality icons and price cells adapt automatically.
- **Smart Tooltips**: Detailed cost breakdowns (Input vs. Output) appear on hover.

---

## 🛠 Installation

Currently in developer preview. To install:

1. **Download** or clone this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **"Developer mode"** in the top-right corner.
4. Click **"Load unpacked"** and select the folder containing this project.
5. Visit [LMArena](https://chat.lmsys.org/?leaderboard) and enjoy!

---

## 📈 The "Bang for Buck" Logic

We believe that intelligence shouldn't always come at a premium. Our algorithm calculates value by:
1. **Measuring Relative Intelligence**: Subtracting a baseline from the Arena Score.
2. **Scaling Cost**: Using a logarithmic curve so that expensive models aren't unfairly penalized for minor price jumps.
3. **Weighting Quality**: Applying a gentle decay to lower ranks, ensuring that a rank #1 model is valued higher than a rank #50 model even if their price/score ratio is similar.

---

## 🤝 Contributing

Feel free to open issues or submit pull requests if you have ideas for new features or data sources!

## ✨ License

Distributed under the GPLv3 License. See `LICENSE` for more information.

---

*Note: This extension is not affiliated with LMSYS or Chatbot Arena. Pricing data is fetched from public APIs of the respective providers.*
