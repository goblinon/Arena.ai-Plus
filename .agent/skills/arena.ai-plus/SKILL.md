---
name: arena-ai-plus
description: Guidelines for developing the Arena.ai Plus Chrome Extension. Use this whenever working on this repository to avoid environment errors.
---

# Arena.ai Plus Development Skill

## 1. Project Context
This is a **Chrome Extension** (Vanilla JS/CSS/HTML) that modifies the `arena.ai` leaderboard.
* **Source:** `content.js`, `popup.js`, `styles.css`, `manifest.json`.
* **Frameworks:** None. This is pure JavaScript.
* **Build System:** None. The source files are loaded directly by the browser.

## 2. Environment Constraints (CRITICAL)
You are running in a headless environment that **cannot** execute Chrome Extensions.

* **⛔ DO NOT** attempt to open a browser to test the extension.
* **⛔ DO NOT** try to visit `chrome://extensions`.
* **⛔ DO NOT** use tools like Puppeteer or Selenium to "preview" the extension; they will fail.

## 3. Interaction with Arena.ai
* **Restricted Access:** You generally should **not** access `https://arena.ai` (or `lmarena.ai`) directly.
* **Exception:** If you absolutely need to fetch the current HTML structure of the leaderboard to write a selector (e.g., "I need to see the ID of the ranking table"), you **must ask the user for permission** first.
    * *Example:* "I need to check the current DOM structure of the leaderboard to fix the CSS selector. May I browse `arena.ai` to get the page source?"

## 4. Testing & Validation Strategy (Human-in-the-Loop)
Since you cannot run the extension, you must rely on the user to test it.

1.  **Make your code changes** to the files.
2.  **Instruct the user** to test:
    > "I have updated `content.js`. Please reload the extension in `chrome://extensions` and refresh the Arena.ai tab to verify the fix."
3.  **Debugging:** If the user reports a bug, ask them to copy errors from the Chrome DevTools Console (F12) and paste them here.

## 5. Development Guidelines
* **Manifest V3:** Ensure all changes comply with Chrome Manifest V3 rules (e.g., no remote code execution).
* **DOM Manipulation:** This extension relies heavily on injecting elements into the DOM. Always check if the target element exists before appending to avoid `null` errors (the leaderboard loads dynamically).
    ```javascript
    // Good practice
    const target = document.querySelector('.target-class');
    if (target) {
        // inject code
    }
    ```