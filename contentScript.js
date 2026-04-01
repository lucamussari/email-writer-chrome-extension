const COMPOSE_BODY_SELECTORS = [
  '[role="textbox"][g_editable="true"]',
  'div[aria-label="Message Body"][contenteditable="true"]',
  'div[aria-label="Message Body"]',
  'div[aria-label="Message text"]',
  'div.editable',
];

const THREAD_BODY_SELECTORS = ['div.ii.gt', 'div.ii.adz', 'div.a3s.aiL'];

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

const TOOLBAR_HOST_ID = 'email-writer-extension-root';

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

const buildPromptPayload = () => {
  const composeEl = getComposeBodyElement();
  if (!composeEl) {
    return null;
  }

  const fullHtml = composeEl.innerHTML;
  const { draftHtml, quoteSuffix } = splitComposeIntoDraftAndQuote(fullHtml);

  const draftPlain = htmlToPlainText(draftHtml);
  const threadPlain = gatherThreadPlainText(composeEl);

  return {
    composeEl,
    quoteSuffix,
    fullHtml,
    draftPlain,
    threadPlain,
  };
};

const buildUserPrompt = (payload, userInstruction) => {
  const threadSection = payload.threadPlain
    ? `Conversation thread (prior messages, oldest to newest):\n${payload.threadPlain}\n\n`
    : '';

  return `${threadSection}Current text in the compose box above any quoted thread (may be empty or a partial draft):\n${payload.draftPlain || '(empty)'}\n\nWhat the user wants this reply to accomplish:\n${userInstruction.trim()}\n\nWrite the email reply body that satisfies those instructions and fits the thread. Match the tone implied by the conversation. Return only the reply text (no subject line). Do not include quoted previous emails in your output.`;
};

async function sendToOpenRouter(payload, userInstruction, apiKey, model) {
  const resolvedModel =
    typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_OPENROUTER_MODEL;

  const userContent = buildUserPrompt(payload, userInstruction);

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
      payload.quoteSuffix,
      payload.composeEl
    );
  } else {
    console.error('No suggestions received', data.error || data);
    throw new Error(data.error?.message || 'No reply from model');
  }
}

function displaySuggestions(suggestions, quoteSuffix, composeEl) {
  const element =
    composeEl && document.contains(composeEl) ? composeEl : getComposeBodyElement();
  if (!element) {
    return;
  }

  let newText = suggestions.trim();
  newText = newText.replace(/\n/g, '<br>');

  if (quoteSuffix) {
    newText = `${newText}<br><br>${quoteSuffix}`;
  }

  if (element.getAttribute('contenteditable') === 'true') {
    element.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertHTML', false, newText);
  } else {
    element.innerHTML = newText;
  }
}

const removeToolbar = () => {
  document.getElementById(TOOLBAR_HOST_ID)?.remove();
};

const setModalOpen = (host, open) => {
  const overlay = host.querySelector('.ew-overlay');
  const launcher = host.querySelector('.ew-launcher');
  const instructions = host.querySelector('#ew-instructions');
  if (!overlay || !launcher) {
    return;
  }
  overlay.hidden = !open;
  launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && instructions) {
    window.requestAnimationFrame(() => {
      instructions.focus();
    });
  }
};

const setLoading = (host, loading) => {
  const btn = host.querySelector('.ew-generate');
  const status = host.querySelector('.ew-status');
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Generating…' : 'Insert reply into email';
  }
  if (status) {
    status.textContent = loading ? 'Talking to the model…' : '';
  }
};

const renderToolbar = (host) => {
  host.classList.add('ew-root');
  host.innerHTML = `
    <button
      type="button"
      class="ew-launcher"
      aria-label="AI reply — describe what to write"
      aria-expanded="false"
      aria-haspopup="dialog"
      aria-controls="ew-reply-dialog"
    >
      <span class="ew-launcher-inner" aria-hidden="true">AI</span>
    </button>
    <div class="ew-overlay" hidden>
      <div class="ew-backdrop" role="presentation"></div>
      <div
        id="ew-reply-dialog"
        class="ew-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ew-modal-title"
      >
        <div class="ew-modal-header">
          <h2 id="ew-modal-title" class="ew-modal-title">AI reply</h2>
          <button type="button" class="ew-modal-dismiss" aria-label="Close">×</button>
        </div>
        <p class="ew-modal-lead">Describe what you want to say. The reply is written from the thread and inserted into the message.</p>
        <label class="ew-label" for="ew-instructions">Your instructions</label>
        <textarea
          id="ew-instructions"
          class="ew-textarea"
          rows="5"
          placeholder="e.g. Thank them and propose a call next Tuesday afternoon…"
        ></textarea>
        <p class="ew-status" role="status" aria-live="polite"></p>
        <div class="ew-actions">
          <button type="button" class="ew-generate">Insert reply into email</button>
          <button type="button" class="ew-close">Cancel</button>
        </div>
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${TOOLBAR_HOST_ID} {
      --ew-cta: #E84B44;
      --ew-cta-hover: #d63f38;
      --ew-border: #dadce0;
      --ew-bg: #ffffff;
      --ew-muted: #5f6368;
      font-family: "Google Sans", Roboto, RobotoDraft, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      box-sizing: border-box;
    }
    #${TOOLBAR_HOST_ID} *, #${TOOLBAR_HOST_ID} *::before, #${TOOLBAR_HOST_ID} *::after {
      box-sizing: border-box;
    }
    #${TOOLBAR_HOST_ID}.ew-root {
      pointer-events: none;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher,
    #${TOOLBAR_HOST_ID} .ew-overlay {
      pointer-events: auto;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher {
      position: absolute;
      bottom: 52px;
      right: 14px;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--ew-border);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 4px rgba(60, 64, 67, 0.2);
      cursor: pointer;
      font: inherit;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: -0.02em;
      color: var(--ew-cta);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher:hover {
      background: #fef6f5;
      border-color: #f5c4c0;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher:focus-visible {
      outline: 2px solid var(--ew-cta);
      outline-offset: 2px;
    }
    #${TOOLBAR_HOST_ID}.ew-root--floating .ew-launcher {
      position: fixed;
      bottom: 88px;
      right: 24px;
    }
    #${TOOLBAR_HOST_ID} .ew-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px 16px;
    }
    #${TOOLBAR_HOST_ID} .ew-overlay[hidden] {
      display: none !important;
    }
    #${TOOLBAR_HOST_ID}.ew-root--in-dialog .ew-overlay {
      position: absolute;
      z-index: 20;
    }
    #${TOOLBAR_HOST_ID} .ew-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(32, 33, 36, 0.45);
    }
    #${TOOLBAR_HOST_ID} .ew-modal {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      max-height: min(90vh, 520px);
      overflow: auto;
      background: var(--ew-bg);
      border-radius: 12px;
      box-shadow: 0 12px 48px rgba(32, 33, 36, 0.35);
      padding: 18px 18px 16px;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-title {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #202124;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-dismiss {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--ew-muted);
      font-size: 22px;
      line-height: 1;
      cursor: pointer;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-dismiss:hover {
      background: #f1f3f4;
      color: #202124;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-dismiss:focus-visible {
      outline: 2px solid var(--ew-cta);
      outline-offset: 2px;
    }
    #${TOOLBAR_HOST_ID} .ew-modal-lead {
      margin: 0 0 14px;
      font-size: 12px;
      color: var(--ew-muted);
      line-height: 1.45;
    }
    #${TOOLBAR_HOST_ID} .ew-label {
      display: block;
      margin-bottom: 6px;
      color: #202124;
      font-weight: 500;
    }
    #${TOOLBAR_HOST_ID} .ew-textarea {
      width: 100%;
      min-height: 100px;
      padding: 10px 12px;
      border: 1px solid var(--ew-border);
      border-radius: 8px;
      font: inherit;
      resize: vertical;
      color: #202124;
    }
    #${TOOLBAR_HOST_ID} .ew-textarea:focus {
      outline: none;
      border-color: var(--ew-cta);
      box-shadow: 0 0 0 2px rgba(232, 75, 68, 0.2);
    }
    #${TOOLBAR_HOST_ID} .ew-status {
      min-height: 1.2em;
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--ew-muted);
    }
    #${TOOLBAR_HOST_ID} .ew-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    #${TOOLBAR_HOST_ID} .ew-generate {
      padding: 10px 18px;
      border: none;
      border-radius: 8px;
      background: var(--ew-cta);
      color: #fff;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    #${TOOLBAR_HOST_ID} .ew-generate:hover:not(:disabled) {
      background: var(--ew-cta-hover);
    }
    #${TOOLBAR_HOST_ID} .ew-generate:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }
    #${TOOLBAR_HOST_ID} .ew-generate:focus-visible {
      outline: 2px solid var(--ew-cta);
      outline-offset: 2px;
    }
    #${TOOLBAR_HOST_ID} .ew-close {
      padding: 10px 16px;
      border: 1px solid var(--ew-border);
      border-radius: 8px;
      background: var(--ew-bg);
      color: #202124;
      font: inherit;
      cursor: pointer;
    }
    #${TOOLBAR_HOST_ID} .ew-close:hover {
      background: #f8f9fa;
    }
    #${TOOLBAR_HOST_ID} .ew-close:focus-visible {
      outline: 2px solid var(--ew-cta);
      outline-offset: 2px;
    }
  `;
  host.prepend(style);

  const launcher = host.querySelector('.ew-launcher');
  const overlay = host.querySelector('.ew-overlay');
  const backdrop = host.querySelector('.ew-backdrop');
  const dismissBtn = host.querySelector('.ew-modal-dismiss');
  const instructions = host.querySelector('#ew-instructions');
  const generateBtn = host.querySelector('.ew-generate');
  const closeBtn = host.querySelector('.ew-close');

  if (
    !instructions ||
    !generateBtn ||
    !closeBtn ||
    !launcher ||
    !overlay ||
    !backdrop ||
    !dismissBtn
  ) {
    return;
  }

  const handleOpen = () => {
    setModalOpen(host, true);
  };

  const handleClose = () => {
    setModalOpen(host, false);
  };

  const handleGenerate = async () => {
    const text = instructions.value.trim();
    if (!text) {
      instructions.focus();
      const status = host.querySelector('.ew-status');
      if (status) {
        status.textContent = 'Describe what you want the reply to say.';
      }
      return;
    }

    chrome.storage.sync.get(['apiKey', 'model'], async (result) => {
      if (!result.apiKey) {
        alert('Add your OpenRouter API key in the extension popup (toolbar icon), then try again.');
        return;
      }

      const payload = buildPromptPayload();
      if (!payload || (!payload.draftPlain && !payload.threadPlain)) {
        alert(
          'Could not read your draft or thread. Open a reply in Gmail with the compose box visible and try again.'
        );
        return;
      }

      setLoading(host, true);
      const statusEl = host.querySelector('.ew-status');
      if (statusEl) {
        statusEl.textContent = '';
      }

      try {
        await sendToOpenRouter(payload, text, result.apiKey, result.model);
        handleClose();
        instructions.value = '';
      } catch (err) {
        console.error(err);
        if (statusEl) {
          statusEl.textContent = 'Something went wrong. Check the console or your API key.';
        }
      } finally {
        setLoading(host, false);
      }
    });
  };

  launcher.addEventListener('click', handleOpen);
  closeBtn.addEventListener('click', handleClose);
  dismissBtn.addEventListener('click', handleClose);
  backdrop.addEventListener('click', handleClose);
  generateBtn.addEventListener('click', handleGenerate);

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  });

  instructions.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  });
};

const ensureToolbar = () => {
  const composeEl = getComposeBodyElement();
  if (!composeEl) {
    removeToolbar();
    return;
  }

  const dialog = composeEl.closest('[role="dialog"]');
  const mountParent = dialog || document.body;

  let host = document.getElementById(TOOLBAR_HOST_ID);
  if (host && host.parentElement !== mountParent) {
    host.remove();
    host = null;
  }

  if (!host) {
    host = document.createElement('div');
    host.id = TOOLBAR_HOST_ID;
    renderToolbar(host);
    mountParent.appendChild(host);
  } else {
    mountParent.appendChild(host);
  }

  if (dialog) {
    host.classList.add('ew-root--in-dialog');
    host.classList.remove('ew-root--floating');
    host.style.cssText =
      'position: absolute; inset: 0; z-index: 6; width: 100%; height: 100%; min-height: 0; pointer-events: none;';
  } else {
    host.classList.remove('ew-root--in-dialog');
    host.classList.add('ew-root--floating');
    host.style.cssText =
      'position: fixed; inset: 0; z-index: 10000; width: 0; height: 0; pointer-events: none; overflow: visible;';
  }
};

const scheduleEnsureToolbar = (() => {
  let t = null;
  return () => {
    if (t) {
      clearTimeout(t);
    }
    t = setTimeout(() => {
      t = null;
      ensureToolbar();
    }, 150);
  };
})();

new MutationObserver(scheduleEnsureToolbar).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

document.addEventListener('focusin', (e) => {
  const body = getComposeBodyElement();
  if (body && e.target && body.contains(e.target)) {
    scheduleEnsureToolbar();
  }
});

scheduleEnsureToolbar();
