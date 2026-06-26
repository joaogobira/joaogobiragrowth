document.addEventListener('DOMContentLoaded', () => {
  const pathInput = document.getElementById('playbook-path');
  const saveBtn = document.getElementById('btn-save');
  const openBtn = document.getElementById('btn-open');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  const PLAYBOOK_DEFAULT = 'file:///C:/Users/PC_User/OneDrive/Documents/Jo%C3%A3o%20Gobira%20Growth/joaogobiragrowth/playbook-recolocacao.html';

  // Carregar URL salva
  chrome.storage.sync.get(['playbookUrl'], (res) => {
    if (res.playbookUrl) {
      pathInput.value = res.playbookUrl;
    } else {
      pathInput.value = PLAYBOOK_DEFAULT;
      // Salvar o padrão se não houver configuração prévia
      chrome.storage.sync.set({ playbookUrl: PLAYBOOK_DEFAULT });
    }
  });

  // Salvar URL
  saveBtn.addEventListener('click', () => {
    const val = pathInput.value.trim();
    if (!val) {
      showStatus('Por favor, insira uma URL válida', false);
      return;
    }
    
    chrome.storage.sync.set({ playbookUrl: val }, () => {
      showStatus('Configuração Salva!', true);
    });
  });

  // Abrir Playbook
  openBtn.addEventListener('click', () => {
    const url = pathInput.value.trim() || PLAYBOOK_DEFAULT;
    chrome.tabs.create({ url: url });
  });

  function showStatus(msg, isSuccess) {
    statusText.textContent = msg;
    statusDot.style.background = isSuccess ? '#30d488' : '#f56c6c';
    if (isSuccess) {
      statusDot.style.boxShadow = '0 0 8px #30d488';
      setTimeout(() => {
        statusText.textContent = 'Extensão Ativa';
        statusDot.style.background = '#30d488';
        statusDot.style.boxShadow = 'none';
      }, 2000);
    }
  }
});
