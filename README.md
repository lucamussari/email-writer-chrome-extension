# Email Writer Chrome Extension

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Code of Conduct](https://img.shields.io/badge/Code%20of%20Conduct-Respectful-orange)](CODE_OF_CONDUCT.md)

This Chrome extension works in Gmail and helps you refine reply drafts with AI. Choose writing styles (for example friendly, business, authoritative, personal, casual, serious, or lighthearted). The extension sends your draft to a model you pick through [OpenRouter](https://openrouter.ai/) and shows a revised version you can use in your reply.

## Installation
To use this extension, you'll need to install it on your Google Chrome browser or any Chromium-based browser. Follow the steps below:

Download or clone the project from GitHub:

```bash
git clone <your-repository-url>
```

Open the Extensions page in Chrome by navigating to `chrome://extensions/`.

Enable "Developer mode" in the top right corner of the Extensions page.

Click the "Load unpacked" button and select the project directory that you cloned or downloaded.

The extension is now installed and ready to use in your Gmail account.

### Configuration

Before you can use the extension, you'll need to set up a few configuration variables:

#### OpenRouter API key and model

The extension calls the OpenRouter API. Create an account and API key at [openrouter.ai](https://openrouter.ai/), then open the extension popup and paste your key. Set an OpenRouter model ID (for example `openai/gpt-4o-mini`). Click **Save Settings**.

#### Signature Delimiter

If your email signature is automatically appended to your email drafts in Gmail, you can specify a delimiter to distinguish the signature from the main content of the email. The extension will use this delimiter to exclude the signature from the analysis.

To configure the signature delimiter, click the extension icon in your browser's toolbar and enter the delimiter in the provided input field. Then click the "Save Settings" button.

## Usage

To use the extension, compose a new email draft in Gmail. After writing the email draft, click the extension icon in your browser's toolbar. Select the desired writing style(s) for your email and click the "Review Email" button.

The extension sends your draft to the configured model and shows a revised reply aligned with the styles you selected. You can then paste or adapt that text in Gmail.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.