const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const editApiKeyButton = document.getElementById('editApiKeyButton');
const saveButton = document.getElementById('saveButton');

const handleSave = () => {
  const apiKey = apiKeyInput.value;
  const model = modelInput.value.trim() || DEFAULT_MODEL;
  const prevLabel = saveButton.textContent;
  chrome.storage.sync.set({ apiKey, model }, () => {
    modelInput.value = model;
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
  modelInput.value = (result.model && result.model.trim()) || DEFAULT_MODEL;
});

editApiKeyButton.addEventListener('click', () => {
  apiKeyInput.readOnly = false;
  apiKeyInput.type = 'text';
  apiKeyInput.focus();
});
