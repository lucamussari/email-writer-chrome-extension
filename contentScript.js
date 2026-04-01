const COMPOSE_BODY_SELECTORS = [
  '[role="textbox"][g_editable="true"]',
  'div[aria-label="Message Body"][contenteditable="true"]',
  'div[aria-label="Message Body"]',
  'div[aria-label="Message text"]',
  'div.editable',
];

const THREAD_BODY_SELECTORS = ['div.ii.gt', 'div.ii.adz', 'div.a3s.aiL'];

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

const getComposeBodyElement = () => {
  for (const sel of COMPOSE_BODY_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      return el;
    }
  }
  return null;
};

const htmlToPlainText = (html) => {
  if (!html || !html.trim()) {
    return '';
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.innerText || tmp.textContent || '').trim();
};

const splitComposeIntoDraftAndQuote = (html) => {
  if (!html) {
    return { draftHtml: '', quoteSuffix: '' };
  }
  const lower = html.toLowerCase();
  let cut = lower.indexOf('<blockquote');
  if (cut === -1) {
    const gq = lower.indexOf('gmail_quote');
    if (gq !== -1) {
      cut = html.lastIndexOf('<', gq);
    }
  }
  if (cut === -1 || cut <= 0) {
    return { draftHtml: html.trim(), quoteSuffix: '' };
  }
  return {
    draftHtml: html.slice(0, cut).trim(),
    quoteSuffix: html.slice(cut),
  };
};

const stripSignatureFromHtml = (html, signatureDelimiter) => {
  if (!signatureDelimiter || !html) {
    return html;
  }
  const idx = html.indexOf(signatureDelimiter);
  if (idx === -1) {
    return html;
  }
  return html.slice(0, idx).trim();
};

const gatherThreadPlainText = (composeEl) => {
  const seen = new Set();
  const chunks = [];

  for (const sel of THREAD_BODY_SELECTORS) {
    document.querySelectorAll(sel).forEach((node) => {
      if (composeEl && composeEl.contains(node)) {
        return;
      }
      const text = (node.innerText || node.textContent || '').trim();
      if (text.length < 8) {
        return;
      }
      if (seen.has(text)) {
        return;
      }
      seen.add(text);
      chunks.push(text);
    });
  }

  return chunks.join('\n\n---\n\n');
};

const buildPromptPayload = (signatureDelimiter) => {
  const composeEl = getComposeBodyElement();
  if (!composeEl) {
    return null;
  }

  const fullHtml = composeEl.innerHTML;
  const htmlForDraft = stripSignatureFromHtml(fullHtml, signatureDelimiter);
  const { draftHtml, quoteSuffix } = splitComposeIntoDraftAndQuote(htmlForDraft);

  const draftPlain = htmlToPlainText(draftHtml);
  const threadPlain = gatherThreadPlainText(composeEl);

  return {
    composeEl,
    quoteSuffix,
    fullHtml,
    signatureDelimiter,
    draftPlain,
    threadPlain,
  };
};

async function sendToChatGPT(payload, styles, apiKey, model) {
  const resolvedModel =
    typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_OPENROUTER_MODEL;

  const styleList = styles.join(', ');
  const threadSection = payload.threadPlain
    ? `Conversation thread (prior messages, oldest to newest):\n${payload.threadPlain}\n\n`
    : '';

  const userContent = `${threadSection}Current reply draft (only the part you should rewrite; quoted thread below the draft in Gmail is omitted here):\n${payload.draftPlain || '(empty)'}\n\nRevise this reply using these style goals: ${styleList}. The reply must fit the conversation above. Return only the revised reply text (no subject line). Do not include quoted previous emails in your output.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'Email Writer Chrome Extension',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userContent }],
      model: resolvedModel,
      max_tokens: 2048,
      n: 1,
      stop: null,
      temperature: 0.8,
    }),
  });

  const data = await response.json();
  if (data.choices && data.choices.length > 0) {
    displaySuggestions(
      data.choices[0].message.content,
      payload.signatureDelimiter,
      payload.quoteSuffix,
      payload.fullHtml
    );
  } else {
    console.log('No suggestions received', data.error || data);
  }
}

function displaySuggestions(suggestions, signatureDelimiter, quoteSuffix, originalFullHtml) {
  const element = getComposeBodyElement();
  if (!element) {
    return;
  }

  let newText = suggestions.trim();
  newText = newText.replace(/\n/g, '<br>');

  if (quoteSuffix) {
    newText = `${newText}<br><br>${quoteSuffix}`;
  }

  if (signatureDelimiter) {
    const signatureIndex = originalFullHtml.indexOf(signatureDelimiter);
    if (signatureIndex !== -1) {
      const signature = originalFullHtml.slice(signatureIndex);
      newText = `${newText}<br><br>${signature}`;
    }
  }

  if (element.getAttribute('contenteditable') === 'true') {
    element.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertHTML', false, newText);
  } else {
    element.innerHTML = newText;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'reviewEmail') {
    const selectedStyles = request.styles;

    if (request) {
      chrome.storage.sync.get(['apiKey', 'model', 'signatureDelimiter'], (result) => {
        if (result.apiKey) {
          const payload = buildPromptPayload(result.signatureDelimiter);
          if (!payload || (!payload.draftPlain && !payload.threadPlain)) {
            alert(
              'Could not read your draft or thread. Open a reply in Gmail with the compose box visible and try again.'
            );
            sendResponse({ success: false });
            return;
          }

          sendToChatGPT(payload, selectedStyles, result.apiKey, result.model)
            .then(() => {
              sendResponse({ success: true });
            })
            .catch(() => {
              sendResponse({ success: false });
            });
        } else {
          alert('Please enter and save your OpenRouter API key in the extension settings.');
          sendResponse({ success: false });
        }
      });
    } else {
      sendResponse({ success: false });
    }

    return true;
  }
});
