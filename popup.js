const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const apiKeyInput = document.getElementById('apiKeyInput');
const modelSelect = document.getElementById('modelSelect');
const modelInput = document.getElementById('modelInput');
const modelHint = document.getElementById('modelHint');
const editApiKeyButton = document.getElementById('editApiKeyButton');
const saveButton = document.getElementById('saveButton');

const PREDEFINED_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-flash-1.5',
  'openrouter/free',
  'meta-llama/llama-3.1-70b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-2-9b-it:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'qwen/qwen3.6-plus-preview',
];

const updateModelUI = (savedModel) => {
  const model = savedModel || DEFAULT_MODEL;
  if (PREDEFINED_MODELS.includes(model)) {
    modelSelect.value = model;
    modelInput.style.display = 'none';
    modelHint.textContent = 'Select a model or choose "Custom" to enter your own.';
  } else {
    modelSelect.value = 'custom';
    modelInput.style.display = 'block';
    modelInput.value = model;
    modelHint.textContent = 'Enter any OpenRouter model ID (e.g., mistralai/mistral-large).';
  }
};

modelSelect.addEventListener('change', () => {
  if (modelSelect.value === 'custom') {
    modelInput.style.display = 'block';
    modelInput.focus();
    modelHint.textContent = 'Enter any OpenRouter model ID (e.g., mistralai/mistral-large).';
  } else {
    modelInput.style.display = 'none';
    modelHint.textContent = 'Select a model or choose "Custom" to enter your own.';
  }
});

const handleSave = () => {
  const apiKey = apiKeyInput.value;
  let model;
  if (modelSelect.value === 'custom') {
    model = modelInput.value.trim() || DEFAULT_MODEL;
  } else {
    model = modelSelect.value;
  }
  const prevLabel = saveButton.textContent;
  chrome.storage.sync.set({ apiKey, model }, () => {
    updateModelUI(model);
    apiKeyInput.readOnly = true;
    apiKeyInput.type = 'password';
    saveButton.textContent = 'Saved';
    window.setTimeout(() => {
      saveButton.textContent = prevLabel;
    }, 1600);
  });
};

saveButton.addEventListener('click', handleSave);

chrome.storage.sync.get(['apiKey', 'model'], (result) => {
  apiKeyInput.value = result.apiKey || '';
  updateModelUI(result.model);
});

editApiKeyButton.addEventListener('click', () => {
  apiKeyInput.readOnly = false;
  apiKeyInput.type = 'text';
  apiKeyInput.focus();
});
