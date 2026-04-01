# Email Writer Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Code of Conduct](https://img.shields.io/badge/Code%20of%20Conduct-Respectful-orange)](CODE_OF_CONDUCT.md)

This Chrome extension works in Gmail and drafts replies with AI. You describe what you want in a popup on the compose window; the extension uses the thread for context, calls a model you choose through [OpenRouter](https://openrouter.ai/), and inserts the reply into the message body.

## Installation
To use this extension, you'll need to install it on your Google Chrome browser or any Chromium-based browser. Follow the steps below:

Download or clone the project from GitHub:

```bash
git clone https://github.com/lucamussari/email-writer-chrome-extension.git
```

Open the Extensions page in Chrome by navigating to `chrome://extensions/`.

Enable "Developer mode" in the top right corner of the Extensions page.

Click the "Load unpacked" button and select the project directory that you cloned or downloaded.

The extension is now installed and ready to use in your Gmail account.

### Configuration

Before you can use the extension, open the extension popup from the toolbar and add your OpenRouter API key and model ID (for example `openai/gpt-4o-mini`). Click **Save settings**.

## Usage

In Gmail, open a compose or reply window. Click the **AI** button on the compose window (near the bottom). In the popup, describe how you want to reply and click **Insert reply into email**. The generated text is inserted into the message body (quoted thread below the draft is preserved when present).

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
