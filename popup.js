const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const signatureDelimiterInput = document.getElementById('signatureDelimiter');
const editApiKeyButton = document.getElementById('editApiKeyButton');
const saveButton = document.getElementById('saveButton');

saveButton.addEventListener("click", () => {
  const apiKey = apiKeyInput.value;
  const model = modelInput.value.trim() || DEFAULT_MODEL;
  const signatureDelimiter = signatureDelimiterInput.value;
  chrome.storage.sync.set({ apiKey, model, signatureDelimiter }, () => {
    modelInput.value = model;
    alert("Settings saved.");
    apiKeyInput.readOnly = true;
    apiKeyInput.type = 'password';
  });
});

document.getElementById("reviewButton").addEventListener("click", () => {
  const selectedStyles = Array.from(document.querySelectorAll('input[name="style"]:checked')).map(input => input.value);

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "reviewEmail", styles: selectedStyles });
  });
});

chrome.storage.sync.get(["apiKey", "model", "signatureDelimiter"], result => {
  apiKeyInput.value = result.apiKey || '';
  modelInput.value = (result.model && result.model.trim()) || DEFAULT_MODEL;

  if (result.signatureDelimiter) {
    signatureDelimiterInput.value = result.signatureDelimiter;
  }
});

editApiKeyButton.addEventListener('click', () => {
  apiKeyInput.readOnly = false;
  apiKeyInput.type = 'text';
  apiKeyInput.focus();
});
