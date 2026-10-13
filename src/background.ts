// Service worker: the toolbar button opens (or focuses) the full-page app.
const APP_URL = chrome.runtime.getURL('app.html');

async function openApp(hash = '') {
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  const existing = tabs[0];
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: APP_URL + hash } : {}) });
    if (existing.windowId != null) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL + hash });
  }
}

chrome.action.onClicked.addListener(() => void openApp());

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void openApp();
});
