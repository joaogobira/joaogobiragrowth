/* ══════════════════════════════════════════════════════
   BLOG ENGINE — João Gobira Growth
   Carrega posts.json, renderiza listagem e posts MD
   ══════════════════════════════════════════════════════ */

const CATEGORY_MAP = {
  'growth':      { label: 'Growth',      cssClass: 'tag-growth' },
  'seo':         { label: 'SEO',         cssClass: 'tag-seo' },
  'performance': { label: 'Performance', cssClass: 'tag-performance' },
  'crm':         { label: 'CRM',         cssClass: 'tag-crm' },
  'carreira':    { label: 'Carreira',    cssClass: 'tag-carreira' },
};

// ── Helpers ──
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function estimateReadTime(text) {
  const words = text.split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return minutes + ' min de leitura';
}

// ══════════════════════════════════════════════════════
// LISTING PAGE (blog/index.html)
// ══════════════════════════════════════════════════════

async function loadPostsList() {
  const grid = document.getElementById('posts-grid');
  if (!grid) return;

  try {
    const res = await fetch('../posts/posts.json');
    const posts = await res.json();

    // Sort by date descending
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    window._allPosts = posts;
    renderPosts(posts);
    setupFilters(posts);
  } catch (err) {
    grid.innerHTML = '<div class="empty-state">Nenhum post encontrado.</div>';
  }
}

function renderPosts(posts) {
  const grid = document.getElementById('posts-grid');

  if (posts.length === 0) {
    grid.innerHTML = '<div class="empty-state">Nenhum post nesta categoria.</div>';
    return;
  }

  grid.innerHTML = posts.map((post, i) => {
    const cat = CATEGORY_MAP[post.category] || { label: post.category, cssClass: 'tag-growth' };
    const isFeatured = i === 0 ? ' featured' : '';
    return `
      <a href="post.html?post=${post.slug}" class="post-card${isFeatured} fade-in">
        <span class="post-tag ${cat.cssClass}">${cat.label}</span>
        <p class="post-title">${post.title}</p>
        <p class="post-excerpt">${post.excerpt}</p>
        <div class="post-meta">
          <span class="post-date">${formatDate(post.date)}</span>
          <span class="post-read-time">${post.readTime || '5 min de leitura'}</span>
          <span class="post-arrow">→</span>
        </div>
      </a>
    `;
  }).join('');

  // Animate cards
  requestAnimationFrame(() => {
    document.querySelectorAll('.post-card.fade-in').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 100);
    });
  });
}

function setupFilters(posts) {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cat = btn.dataset.category;
      if (cat === 'todos') {
        renderPosts(posts);
      } else {
        renderPosts(posts.filter(p => p.category === cat));
      }
    });
  });
}

// ══════════════════════════════════════════════════════
// POST PAGE (blog/post.html)
// ══════════════════════════════════════════════════════

async function loadPost() {
  const container = document.getElementById('post-body');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('post');

  if (!slug) {
    container.innerHTML = '<p>Post não encontrado.</p>';
    return;
  }

  try {
    // Load post metadata
    const metaRes = await fetch('../posts/posts.json');
    const posts = await metaRes.json();
    const postMeta = posts.find(p => p.slug === slug);

    if (!postMeta) {
      container.innerHTML = '<p>Post não encontrado.</p>';
      return;
    }

    // Load markdown
    const mdRes = await fetch(`../posts/${slug}.md`);
    const mdText = await mdRes.text();

    // Render header
    const headerEl = document.getElementById('post-header');
    const cat = CATEGORY_MAP[postMeta.category] || { label: postMeta.category, cssClass: 'tag-growth' };

    headerEl.innerHTML = `
      <a href="index.html" class="back-link">← Voltar ao Blog</a>
      <span class="post-tag ${cat.cssClass}">${cat.label}</span>
      <h1>${postMeta.title}</h1>
      <div class="post-header-meta">
        <span class="author">João Gobira</span>
        <span class="date">${formatDate(postMeta.date)}</span>
        <span class="date">${estimateReadTime(mdText)}</span>
      </div>
    `;

    // Update page title
    document.title = postMeta.title + ' — João Gobira Blog';

    // Render markdown to HTML using marked.js
    container.innerHTML = marked.parse(mdText);

    // Inject BlogPosting schema for AI-SEO
    injectPostSchema(postMeta, mdText);

  } catch (err) {
    container.innerHTML = '<p>Erro ao carregar o post.</p>';
  }
}

function injectPostSchema(meta, bodyText) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": meta.title,
    "description": meta.excerpt,
    "datePublished": meta.date,
    "dateModified": meta.date,
    "author": {
      "@type": "Person",
      "name": "João Gobira",
      "jobTitle": "Head de Growth & Marketing",
      "url": "https://joaogobira.com"
    },
    "publisher": {
      "@type": "Person",
      "name": "João Gobira"
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": window.location.href
    },
    "wordCount": bodyText.split(/\s+/).length,
    "articleSection": meta.category
  };

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(schema);
  document.head.appendChild(script);
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadPostsList();
  loadPost();
});
