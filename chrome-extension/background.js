/* =============================================
   PLAYBOOK JG — BACKGROUND SERVICE WORKER
   Permite abrir URLs locais (file:///) no Chrome
   ============================================= */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openTab') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ success: true });
  }
  return true; // Mantém o canal de mensagens aberto para resposta assíncrona
});
