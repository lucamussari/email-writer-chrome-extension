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

/** Parent we set to position:relative so the host can fill the compose shell */
let hostPositionFixEl = null;

const clearHostPositionFix = () => {
  if (hostPositionFixEl) {
    hostPositionFixEl.style.removeProperty('position');
    hostPositionFixEl = null;
  }
};

const getComposeBodyElement = () => {
  for (const sel of COMPOSE_BODY_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) {
      return el;
    }
  }
  return null;
};

const containsSendOrComposeFooter = (node) => {
  if (!node?.querySelector) {
    return false;
  }
  return !!(
    node.querySelector('[aria-label*="Send"]') ||
    node.querySelector('[data-tooltip*="Send"]') ||
    node.querySelector('[guidedhelpid="send_button"]') ||
    node.querySelector('div[role="button"][aria-label^="Send"]')
  );
};

/**
 * Prefer the smallest wrapper that includes the editor and the real footer (Send),
 * so the launcher stays inside the compose card — not the viewport gutter.
 */
const findComposeMountRoot = (composeEl) => {
  let el = composeEl;
  let withFooter = null;
  for (let i = 0; i < 28 && el; i++) {
    if (containsSendOrComposeFooter(el)) {
      withFooter = el;
      break;
    }
    el = el.parentElement;
  }
  if (withFooter) {
    return withFooter;
  }

  const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) =>
    d.contains(composeEl)
  );
  if (!dialogs.length) {
    return document.body;
  }
  dialogs.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.width * ra.height - rb.width * rb.height;
  });
  return dialogs[0];
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

  const requestBody = {
    messages: [{ role: 'user', content: userContent }],
    model: resolvedModel,
    max_tokens: 2048,
    temperature: 0.8,
  };

  console.log('Sending to OpenRouter:', { model: resolvedModel, body: requestBody });

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': location.origin,
      'X-Title': 'Email Writer Chrome Extension',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errorMsg = data.error?.message || data.error?.code || `HTTP ${response.status}: ${response.statusText}`;
    console.error('OpenRouter API error:', {
      status: response.status,
      model: resolvedModel,
      error: data.error,
      fullResponse: data,
    });
    throw new Error(errorMsg);
  }

  if (data.choices && data.choices.length > 0) {
    displaySuggestions(
      data.choices[0].message.content,
      payload.quoteSuffix,
      payload.composeEl
    );
  } else {
    console.error('No suggestions received', data);
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
    // Focus and select all existing content
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    // Delete selected content
    range.deleteContents();

    // Insert new HTML using insertAdjacentHTML (reliable in Gmail)
    element.insertAdjacentHTML('beforeend', newText);

    // Move cursor to end
    element.focus();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(element);
    newRange.collapse(false);
    selection.addRange(newRange);
  } else {
    element.innerHTML = newText;
  }
}

const removeToolbar = () => {
  clearHostPositionFix();
  document.getElementById(TOOLBAR_HOST_ID)?.remove();
};

const isExtensionModalOpen = () => {
  const host = document.getElementById(TOOLBAR_HOST_ID);
  const overlay = host?.querySelector('.ew-overlay');
  return !!(overlay && !overlay.hidden);
};

const ensurePositionedMount = (mountParent) => {
  clearHostPositionFix();
  if (!mountParent || mountParent === document.body) {
    return;
  }
  const cs = getComputedStyle(mountParent);
  if (cs.position === 'static') {
    mountParent.style.position = 'relative';
    hostPositionFixEl = mountParent;
  }
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
    const focusTextarea = () => {
      instructions.focus({ preventScroll: true });
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(focusTextarea);
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

const getLauncherIconMarkup = () => {
  try {
    const url = chrome.runtime.getURL('icon48.png');
    return `<img class="ew-launcher-icon" src="${url}" width="22" height="22" alt="" draggable="false" /><span class="ew-launcher-fallback" aria-hidden="true" hidden>AI</span>`;
  } catch {
    return '<span class="ew-launcher-fallback" aria-hidden="true">AI</span>';
  }
};

const renderToolbar = (host) => {
  host.classList.add('ew-root');
  const iconMarkup = getLauncherIconMarkup();
  host.innerHTML = `
    <button
      type="button"
      class="ew-launcher"
      aria-label="AI reply — describe what to write"
      aria-expanded="false"
      aria-haspopup="dialog"
      aria-controls="ew-reply-dialog"
    >
      ${iconMarkup}
    </button>
    <div class="ew-overlay" hidden>
      <div class="ew-backdrop" role="presentation" tabindex="-1"></div>
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
        <p class="ew-modal-lead">Describe what you want to say. The reply uses the thread and is inserted into the message.</p>
        <label class="ew-label" for="ew-instructions">Your instructions</label>
        <textarea
          id="ew-instructions"
          class="ew-textarea"
          rows="5"
          placeholder="e.g. Thank them and propose a call next Tuesday afternoon…"
          autocomplete="off"
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
      top: 48px;
      right: 12px;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid var(--ew-border);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 4px rgba(60, 64, 67, 0.2);
      cursor: pointer;
      font: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher-icon {
      display: block;
      width: 22px;
      height: 22px;
      object-fit: contain;
      pointer-events: none;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher-fallback {
      font-weight: 700;
      font-size: 11px;
      color: var(--ew-cta);
    }
    #${TOOLBAR_HOST_ID} .ew-launcher:hover {
      background: #fef6f5;
      border-color: #f5c4c0;
    }
    #${TOOLBAR_HOST_ID} .ew-launcher:focus-visible {
      outline: 2px solid var(--ew-cta);
      outline-offset: 2px;
    }
    #${TOOLBAR_HOST_ID}.ew-root--body-fallback .ew-launcher {
      position: fixed;
      bottom: auto;
      right: auto;
    }
    #${TOOLBAR_HOST_ID} .ew-overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px 12px;
    }
    #${TOOLBAR_HOST_ID} .ew-overlay[hidden] {
      display: none !important;
    }
    #${TOOLBAR_HOST_ID}.ew-root--body-fallback .ew-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
    }
    #${TOOLBAR_HOST_ID} .ew-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(32, 33, 36, 0.45);
    }
    #${TOOLBAR_HOST_ID}.ew-root--body-fallback .ew-backdrop {
      position: fixed;
    }
    #${TOOLBAR_HOST_ID} .ew-modal {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 420px;
      max-height: min(88vh, 520px);
      overflow: auto;
      background: var(--ew-bg);
      border-radius: 12px;
      box-shadow: 0 12px 48px rgba(32, 33, 36, 0.35);
      padding: 18px 18px 16px;
      pointer-events: auto;
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
      pointer-events: auto;
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
  const modal = host.querySelector('.ew-modal');
  const instructions = host.querySelector('#ew-instructions');
  const generateBtn = host.querySelector('.ew-generate');
  const closeBtn = host.querySelector('.ew-close');
  const launcherImg = host.querySelector('.ew-launcher-icon');
  const launcherFallback = host.querySelector('.ew-launcher-fallback');

  if (
    !instructions ||
    !generateBtn ||
    !closeBtn ||
    !launcher ||
    !overlay ||
    !backdrop ||
    !dismissBtn ||
    !modal
  ) {
    return;
  }

  if (launcherImg && launcherFallback) {
    launcherImg.addEventListener('error', () => {
      launcherImg.hidden = true;
      launcherFallback.removeAttribute('hidden');
    });
  }

  const stopGmailBubble = (e) => {
    e.stopPropagation();
  };

  /* Bubble phase only — capture on ancestors would run before the textarea and block focus/typing. */
  modal.addEventListener('mousedown', stopGmailBubble);
  modal.addEventListener('click', stopGmailBubble);
  modal.addEventListener('keydown', stopGmailBubble);

  const handleClose = () => {
    setModalOpen(host, false);
  };

  const handleOpen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(host, true);
  };

  const handleGenerate = async () => {
    const text = instructions.value.trim();
    if (!text) {
      instructions.focus({ preventScroll: true });
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
          let msg = 'Something went wrong. Check the console or your API key.';
          if (err.message?.includes('No endpoints found')) {
            msg = `Model "${result.model}" is temporarily unavailable. Try a different model from the popup.`;
          } else if (err.message?.includes('Authentication') || err.message?.includes('Unauthorized')) {
            msg = 'Invalid API key. Check your OpenRouter API key in the extension popup.';
          } else if (err.message?.includes('not found') || err.message?.includes('does not exist')) {
            msg = `Model "${result.model}" not found. Check the model ID in the popup.`;
          }
          statusEl.textContent = msg;
        }
      } finally {
        setLoading(host, false);
      }
    });
  };

  launcher.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });
  launcher.addEventListener('click', handleOpen);
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleClose();
  });
  dismissBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleClose();
  });
  backdrop.addEventListener('click', (e) => {
    e.stopPropagation();
    handleClose();
  });
  generateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleGenerate();
  });

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  });

  instructions.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  });

  /* Focus trap: when the modal is open, keep focus inside it.
     Gmail registers capture-phase listeners on the compose container that
     steal focus back to the compose body. Detecting blur and immediately
     re-focusing the textarea wins the race without needing to intercept
     capture-phase events. We skip refocus when focus moves to another
     element *within* the modal (buttons, dismiss) so those remain clickable. */
  instructions.addEventListener('blur', (e) => {
    if (!isExtensionModalOpen()) return;
    if (e.relatedTarget && host.contains(e.relatedTarget)) return;
    requestAnimationFrame(() => {
      if (isExtensionModalOpen()) {
        instructions.focus({ preventScroll: true });
      }
    });
  });
};

/**
 * For the normal (non-body) case the host fills mountParent via inset:0.
 * CSS `right:52px` would then be measured from mountParent's right edge,
 * which can be far outside the visible compose box when mountParent is a
 * large container spanning the full reading pane. Compute the correct values
 * from the compose body's actual viewport rect relative to mountParent.
 */
const positionLauncherInMount = (host, composeEl, mountParent) => {
  const btn = host.querySelector('.ew-launcher');
  if (!btn) return;
  const composeRect = composeEl.getBoundingClientRect();
  const mountRect = mountParent.getBoundingClientRect();
  // Position below any existing Gmail icons at top-right of compose box
  const right = Math.max(4, mountRect.right - composeRect.right + 12);
  const top = Math.max(48, composeRect.top - mountRect.top + 48); // 48px down to avoid existing icons
  btn.style.right = `${Math.round(right)}px`;
  btn.style.top = `${Math.round(top)}px`;
  btn.style.bottom = 'auto';
};

const placeBodyFallbackLauncher = (host, composeEl) => {
  const r = composeEl.getBoundingClientRect();
  const btn = host.querySelector('.ew-launcher');
  if (!btn) {
    return;
  }
  const margin = 10;
  // Position below any existing icons at top-right of compose box
  const top = Math.max(margin + 40, r.top + 48); // 48px down to avoid existing icons
  const right = Math.max(margin, window.innerWidth - r.right + 12);
  btn.style.top = `${Math.round(top)}px`;
  btn.style.right = `${Math.round(right)}px`;
  btn.style.left = 'auto';
};

const ensureToolbar = () => {
  const composeEl = getComposeBodyElement();
  if (!composeEl) {
    removeToolbar();
    return;
  }

  if (isExtensionModalOpen()) {
    return;
  }

  const mountParent = findComposeMountRoot(composeEl);
  let host = document.getElementById(TOOLBAR_HOST_ID);

  if (host && host.parentElement !== mountParent) {
    host.remove();
    host = null;
    clearHostPositionFix();
  }

  if (!host) {
    ensurePositionedMount(mountParent);
    host = document.createElement('div');
    host.id = TOOLBAR_HOST_ID;
    renderToolbar(host);
    mountParent.appendChild(host);
  }

  const onBody = mountParent === document.body;
  if (onBody) {
    host.classList.add('ew-root--body-fallback');
    host.style.cssText =
      'position:fixed;inset:0;width:0;height:0;overflow:visible;z-index:10000;pointer-events:none;';
    placeBodyFallbackLauncher(host, composeEl);
  } else {
    host.classList.remove('ew-root--body-fallback');
    host.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;min-height:0;z-index:6;pointer-events:none;overflow:visible;';
    positionLauncherInMount(host, composeEl, mountParent);
  }
};

const scheduleEnsureToolbar = (() => {
  let t = null;
  return () => {
    if (isExtensionModalOpen()) {
      return;
    }
    if (t) {
      clearTimeout(t);
    }
    t = setTimeout(() => {
      t = null;
      ensureToolbar();
    }, 320);
  };
})();

new MutationObserver(scheduleEnsureToolbar).observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener(
  'scroll',
  () => {
    scheduleEnsureToolbar();
  },
  true
);

window.addEventListener('resize', scheduleEnsureToolbar);

document.addEventListener('focusin', (e) => {
  const body = getComposeBodyElement();
  if (body && e.target && body.contains(e.target)) {
    scheduleEnsureToolbar();
  }
});

ensureToolbar();
