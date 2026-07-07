/* =============================================
   PLAYBOOK JG — CONTENT SCRIPT
   Detecta vagas em: LinkedIn, Gupy, Catho,
   Indeed, InfoJobs, Vagas.com, Glassdoor
   ============================================= */

(function () {
  'use strict';

  // Evitar injeção dupla
  if (document.getElementById('pbj-fab')) return;

  // ── CONFIG ──────────────────────────────────
  const PLAYBOOK_DEFAULT = 'file:///C:/Users/PC_User/OneDrive/Documents/Jo%C3%A3o%20Gobira%20Growth/joaogobiragrowth/playbook-recolocacao.html';
  let playbookUrl = PLAYBOOK_DEFAULT;

  // Carrega caminho configurado pelo usuário
  chrome.storage.sync.get(['playbookUrl'], (res) => {
    if (res.playbookUrl) playbookUrl = res.playbookUrl;
  });

  // ── DETECTORES POR PLATAFORMA ────────────────
  const EXTRACTORS = {

    linkedin: {
      match: () => location.hostname.includes('linkedin.com'),
      detect: () => {
        // É página de vaga se há detalhes de job
        return !!(
          document.querySelector('.jobs-unified-top-card, .job-details-jobs-unified-top-card__job-title, .jobs-search__job-details, .jobs-details__main-content')
        );
      },
      extract: () => {
        const sel = (s) => document.querySelector(s)?.innerText?.trim() || '';
        const cargo = sel([
          '.job-details-jobs-unified-top-card__job-title h1',
          '.jobs-unified-top-card__job-title h1',
          '.jobs-unified-top-card__job-title',
          'h1.topcard__title',
          '.job-view-layout h1'
        ].join(','));
        const empresa = sel([
          '.job-details-jobs-unified-top-card__company-name',
          '.jobs-unified-top-card__company-name',
          '.topcard__org-name-link',
          '.jobs-unified-top-card__subtitle-primary-grouping a'
        ].join(','));
        const local = sel([
          '.job-details-jobs-unified-top-card__bullet',
          '.jobs-unified-top-card__bullet',
          '.topcard__flavor--bullet'
        ].join(','));
        const descEl = document.querySelector([
          '.jobs-description-content__text',
          '.jobs-description__content',
          '#job-details',
          '.jobs-box__html-content'
        ].join(','));
        const descricao = descEl ? descEl.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    },

    gupy: {
      match: () => location.hostname.includes('gupy.io'),
      detect: () => !!(document.querySelector('[data-testid="job-title"], h1, .job-title')),
      extract: () => {
        const sel = (s) => document.querySelector(s)?.innerText?.trim() || '';
        const cargo = sel('[data-testid="job-title"], h1.sc-hKgILt, h1');
        const empresa = sel('[data-testid="company-name"], .company-name');
        const local = sel('[data-testid="job-location"], .job-location');
        const descEl = document.querySelector([
          '[data-testid="job-description"]',
          '.sc-eCssSg',
          'main article',
          '#job-description'
        ].join(','));
        const descricao = descEl ? descEl.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    },

    catho: {
      match: () => location.hostname.includes('catho.com.br'),
      detect: () => !!(document.querySelector('h1, .job-title, [class*="JobTitle"]')),
      extract: () => {
        const sel = (s) => document.querySelector(s)?.innerText?.trim() || '';
        const cargo = sel('h1, [class*="JobTitle"], [class*="job-title"]');
        const empresa = sel('[class*="CompanyName"], [class*="company-name"], [class*="empresa"]');
        const local = sel('[class*="Location"], [class*="location"]');
        const descEl = document.querySelector('[class*="Description"], [class*="description"], main');
        const descricao = descEl ? descEl.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    },

    indeed: {
      match: () => location.hostname.includes('indeed.com'),
      detect: () => !!(document.querySelector('.jobsearch-JobInfoHeader-title, h1.jobsearch-JobInfoHeader-title')),
      extract: () => {
        const sel = (s) => document.querySelector(s)?.innerText?.trim() || '';
        const cargo = sel('.jobsearch-JobInfoHeader-title, h1[class*="JobTitle"]');
        const empresa = sel('.jobsearch-InlineCompanyRating-companyHeader, [data-testid="inlineHeader-companyName"]');
        const local = sel('[data-testid="job-location"], .jobsearch-JobInfoHeader-subtitle');
        const descEl = document.querySelector('#jobDescriptionText, .jobsearch-jobDescriptionText');
        const descricao = descEl ? descEl.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    },

    infojobs: {
      match: () => location.hostname.includes('infojobs.com.br'),
      detect: () => !!(document.querySelector('h1.title, .job-title, h1[class*="title"]')),
      extract: () => {
        const sel = (s) => document.querySelector(s)?.innerText?.trim() || '';
        const cargo = sel('h1.title, h1[class*="title"]');
        const empresa = sel('.company-name, [class*="company"]');
        const local = sel('.location, [class*="location"]');
        const descEl = document.querySelector('.job-description, [class*="description"]');
        const descricao = descEl ? descEl.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    },

    generic: {
      match: () => true,
      detect: () => true,
      extract: () => {
        const cargo = document.querySelector('h1')?.innerText?.trim() || document.title;
        const empresa = '';
        const local = '';
        const main = document.querySelector('main, article, [class*="job-desc"], [class*="description"]');
        const descricao = main ? main.innerText.trim().substring(0, 6000) : '';
        return { cargo, empresa, local, descricao, url: location.href };
      }
    }
  };

  // ── OBTER EXTRATOR ────────────────────────────
  function getExtractor() {
    for (const [, ext] of Object.entries(EXTRACTORS)) {
      if (ext.match() && ext.detect()) return ext;
    }
    return EXTRACTORS.generic;
  }

  // ── ENCODE para URL hash ──────────────────────
  function encodeData(data) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }

  // ── TOAST ────────────────────────────────────
  function showToast(msg) {
    let t = document.getElementById('pbj-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pbj-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('pbj-show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('pbj-show'), 3000);
  }

  // ── ENVIAR PARA PLAYBOOK ──────────────────────
  function sendToPlaybook() {
    const fab = document.getElementById('pbj-fab');
    if (fab) {
      fab.classList.add('pbj-loading');
      fab.querySelector('.pbj-icon').textContent = '⏳';
    }

    try {
      const extractor = getExtractor();
      const data = extractor.extract();

      if (!data.cargo && !data.descricao) {
        showToast('⚠️ Não consegui encontrar os dados. Tente numa página de vaga aberta.');
        if (fab) {
          fab.classList.remove('pbj-loading');
          fab.querySelector('.pbj-icon').textContent = '🤖';
        }
        return;
      }

      const encoded = encodeData(data);
      const targetUrl = playbookUrl + '#import=' + encoded;

      chrome.storage.sync.get(['playbookUrl'], (res) => {
        const url = (res.playbookUrl || PLAYBOOK_DEFAULT) + '#import=' + encoded;
        chrome.runtime.sendMessage({ action: 'openTab', url: url }, (response) => {
          showToast('✅ Vaga enviada para o Playbook!');
        });
      });

    } catch (e) {
      showToast('❌ Erro: ' + e.message);
      console.error('[Playbook JG]', e);
    }

    setTimeout(() => {
      if (fab) {
        fab.classList.remove('pbj-loading');
        fab.querySelector('.pbj-icon').textContent = '🤖';
      }
    }, 1500);
  }

  // ── CRIAR BOTÃO FLUTUANTE ──────────────────────
  function createFAB() {
    if (document.getElementById('pbj-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'pbj-fab';
    fab.innerHTML = `
      <span class="pbj-icon">🤖</span>
      <span class="pbj-text">
        <span class="pbj-label">Analisar com IA</span>
        <span class="pbj-sub">→ Playbook JG</span>
      </span>
    `;
    fab.addEventListener('click', sendToPlaybook);
    document.body.appendChild(fab);
  }

  // ── OBSERVER — aguarda renderização dinâmica ──
  function tryInject() {
    const extractor = getExtractor();
    if (extractor.detect()) {
      createFAB();
    }
  }

  // LinkedIn e outros SPAs carregam dinamicamente
  const observer = new MutationObserver(() => {
    if (!document.getElementById('pbj-fab')) {
      tryInject();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Tentativa inicial com delay para SPAs
  setTimeout(tryInject, 1000);
  setTimeout(tryInject, 2500);
  setTimeout(tryInject, 5000);

})();
