const scanBtn = document.getElementById("scanBtn");
const statusEl = document.getElementById("status");

function setStatus(text, level) {
  statusEl.textContent = text;
  statusEl.className = level || "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return true;
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["category-map.js", "content-script.js"],
    });
    return true;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "EXPORT_PROGRESS") {
    setStatus(msg.message || "", msg.level || "");
    if (msg.done) {
      scanBtn.disabled = false;
    }
  }
});

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  setStatus("Starting…");

  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url) {
      setStatus("No active tab found.", "err");
      scanBtn.disabled = false;
      return;
    }
    if (!/^https:\/\/es\.wallapop\.com\//i.test(tab.url)) {
      setStatus(
        "Open your Wallapop published catalogue on es.wallapop.com first.",
        "warn",
      );
      scanBtn.disabled = false;
      return;
    }

    await ensureContentScript(tab.id);

    const ping = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    if (!ping?.isCatalog) {
      setStatus(
        "Go to https://es.wallapop.com/app/catalog/published then click Scan again.",
        "warn",
      );
      scanBtn.disabled = false;
      return;
    }

    setStatus("Scanning catalogue… keep this popup open for live progress.");
    await chrome.tabs.sendMessage(tab.id, { type: "START_EXPORT" });
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), "err");
    scanBtn.disabled = false;
  }
});
