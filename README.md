# Kompleter — AI Autocomplete

A Chrome extension that brings AI-powered inline autocomplete to any text input on the web, powered by [OpenRouter](https://openrouter.ai).

## Features

- **Ctrl+Space** to trigger a completion suggestion
- **Ghost text** overlay shows the suggestion inline — press **Tab** to accept
- Works in any `<textarea>`, `<input>`, or `contenteditable` element
- Per-site enable/disable toggle
- Per-site context extraction via CSS selector (useful for AI chat UIs)
- Configurable model, temperature, max tokens, and system prompt
- Dynamic model list fetched from OpenRouter (free models highlighted, cached 24 h)

## Installation

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the `kompleter` folder
5. The extension icon will appear in your toolbar

## Setup

1. Get a free API key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Click the Kompleter icon and enter your API key
3. Pick a model from the list (free models are marked)
4. Click **Save settings**

## Usage

| Action | Key |
|--------|-----|
| Trigger autocomplete | `Ctrl+Space` |
| Accept suggestion | `Tab` |
| Dismiss suggestion | `Escape` or any other key |

### Per-site settings

Open the popup while on any site to:

- Toggle the extension on/off for that hostname
- Set a **CSS selector** to pull context from a specific element on the page (e.g. `#chat-log` in a chat UI) — the extracted text is injected into the prompt as `{{page_context}}`

### Prompt placeholders

The system prompt supports two placeholders:

| Placeholder | Replaced with |
|-------------|--------------|
| `{{context_string}}` | Text already in the focused field |
| `{{page_context}}` | Text extracted from the CSS-selector element |

## Configuration options

| Setting | Default | Range |
|---------|---------|-------|
| Model | `openai/gpt-4o-mini` | Any OpenRouter model |
| Temperature | `0.7` | 0 – 2 |
| Max tokens | `200` | 10 – 4096 |

## Tech stack

- Manifest v3 Chrome Extension
- Vanilla JavaScript — zero dependencies, no build step
- OpenRouter API (`https://openrouter.ai/api/v1/`)
- Chrome Storage API (sync for global settings, local for per-site settings and model cache)

## File structure

```
kompleter/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker — calls OpenRouter API
├── content.js          # Injected script — keyboard handling, ghost text
├── content.css         # Ghost text & spinner styles
├── popup/
│   ├── popup.html      # Settings UI
│   ├── popup.js        # Settings logic, model picker
│   └── popup.css       # Settings styles
└── icons/              # Extension icons (16/32/48/128 px)
```

## Privacy

- Your API key is stored in Chrome's sync storage (encrypted by Chrome, synced across your signed-in devices)
- No data is sent anywhere except directly to OpenRouter when you press Ctrl+Space
- No analytics, no telemetry

## License

MIT — see [LICENSE](LICENSE)
