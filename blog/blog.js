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
    const res = await fetch('/posts/posts.json');
    const posts = await res.json();

    // Sort by date descending
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));

    window._allPosts = posts;
    renderPosts(posts);
    setupFilters(posts);

    // Auto-filter from URL param (e.g. ?cat=seo)
    const params = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');
    if (catParam) {
      const btn = document.querySelector(`.filter-btn[data-category="${catParam}"]`);
      if (btn) btn.click();
    }
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
      <a href="/blog/post/?post=${post.slug}" class="post-card${isFeatured} fade-in">
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
  let slug = params.get('post');

  if (!slug) {
    const match = window.location.pathname.match(/\/blog\/([^\/\?]+)/);
    if (match) slug = match[1];
  }

  if (!slug) {
    container.innerHTML = '<p>Post não encontrado.</p>';
    return;
  }

  try {
    // Load post metadata
    const metaRes = await fetch('/posts/posts.json');
    const posts = await metaRes.json();
    const postMeta = posts.find(p => p.slug === slug);

    if (!postMeta) {
      container.innerHTML = '<p>Post não encontrado.</p>';
      return;
    }

    // Load markdown
    const mdRes = await fetch(`/posts/${slug}.md`);
    const mdText = await mdRes.text();

    // Render header
    const headerEl = document.getElementById('post-header');
    const cat = CATEGORY_MAP[postMeta.category] || { label: postMeta.category, cssClass: 'tag-growth' };
    const pubYear = new Date(postMeta.date + 'T12:00:00').getFullYear();

    // Breadcrumb
    const breadcrumb = `
      <div class="breadcrumb">
        <a href="../">Home</a>
        <span>›</span>
        <a href="index.html">Blog</a>
        <span>›</span>
        <a href="/blog/" class="breadcrumb-cat">${cat.label}</a>
        <span>›</span>
        <span>${postMeta.title.substring(0, 40)}...</span>
      </div>
    `;

    headerEl.innerHTML = breadcrumb + `
      <a href="/blog/" class="back-link">← Voltar ao Blog</a>
      <span class="post-tag ${cat.cssClass}">${cat.label}</span>
      <h1>${postMeta.title}</h1>
      <div class="post-header-meta">
        <span class="author">João Gobira</span>
        <span class="date">${formatDate(postMeta.date)}</span>
        <span class="date">${estimateReadTime(mdText)}</span>
      </div>
    `;

    // Update page title with SEO-friendly format
    document.title = postMeta.title + ' | ' + cat.label + ' | João Gobira Blog (' + pubYear + ')';

    // Render markdown to HTML using marked.js
    container.innerHTML = marked.parse(mdText);

    // Inject lead capture form
    injectLeadForm(container);

    // Inject author bio section
    injectAuthorBio(container);

    // Inject related posts (same category)
    injectRelatedPosts(container, posts, postMeta);

    // Inject recent posts (last 3, excluding current)
    injectRecentPosts(container, posts, postMeta);

    // Inject Open Graph, Twitter Cards, canonical
    injectMetaTags(postMeta);

    // Inject BlogPosting schema for AI-SEO
    injectPostSchema(postMeta, mdText);

    // Inject meta description tag
    injectMetaDescription(postMeta);

  } catch (err) {
    container.innerHTML = '<p>Erro ao carregar o post.</p>';
  }
}

function injectLeadForm(container) {
  const form = document.createElement('div');
  form.className = 'lead-form';
  form.innerHTML = `
    <div class="lead-form-inner">
      <div class="lead-form-icon">✉</div>
      <h3 class="lead-form-title">Receba os próximos artigos</h3>
      <p class="lead-form-text">Growth na prática, direto na sua caixa de entrada. Sem spam. Sem teoria vazia. Só o que funciona.</p>
      <form class="lead-form-fields" action="#" method="POST">
        <input type="text" name="nome" placeholder="Seu nome" required class="lead-input lead-input-name" />
        <input type="email" name="email" placeholder="Seu melhor e-mail" required class="lead-input lead-input-email" />
        <button type="submit" class="lead-btn">Quero receber</button>
      </form>
      <p class="lead-form-footer">Sem spam. Descadastre-se quando quiser.</p>
    </div>
  `;
  form.querySelector('form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const formEl = this;
    const btn = formEl.querySelector('.lead-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Enviando...';
    btn.disabled = true;
    try {
      const data = { name: formEl.nome.value, email: formEl.email.value };
      // Envia para uma API de newsletter - configure o endpoint
      const res = await fetch(formEl.action || '/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok || res.status === 0) {
        formEl.innerHTML = '<div class="lead-success"><span class="lead-success-icon">✓</span><p><strong>Você está dentro!</strong> Agora é só confirmar o e-mail que enviamos.</p></div>';
      } else {
        throw new Error('Erro no servidor');
      }
    } catch (err) {
      btn.textContent = 'Erro. Tente novamente.';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 3000);
    }
  });
  container.appendChild(form);
}

function injectAuthorBio(container) {
  const bio = document.createElement('div');
  bio.className = 'author-bio';
  bio.innerHTML = `
    <div class="author-bio-inner">
      <img src="images/joao-gobira.jpg" alt="João Gobira" class="author-photo" />
      <div class="author-info">
        <strong class="author-name">João Gobira</strong>
        <span class="author-role">Head de Growth & Marketing</span>
        <p class="author-desc">12+ anos construindo resultado em SEO, mídia de performance, CRM e e-commerce. Escrevo sobre o que realmente funciona — sem teoria vazia.</p>
        <div class="author-links">
          <a href="https://www.linkedin.com/in/joaogobira/" target="_blank" rel="noopener" class="author-link linkedin">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            LinkedIn
          </a>
          <a href="https://www.instagram.com/joaogobira/" target="_blank" rel="noopener" class="author-link instagram">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            Instagram
          </a>
        </div>
      </div>
    </div>
  `;
  container.appendChild(bio);
}

function injectRelatedPosts(container, posts, currentPost) {
  const related = posts
    .filter(p => p.slug !== currentPost.slug && p.category === currentPost.category)
    .slice(0, 3);

  if (related.length === 0) return;

  const section = document.createElement('div');
  section.className = 'related-posts';
  section.innerHTML = `
    <h3 class="related-posts-title">Leia também</h3>
    <div class="related-posts-grid">
      ${related.map(p => {
        const c = CATEGORY_MAP[p.category] || { label: p.category, cssClass: 'tag-growth' };
        return `
          <a href="/blog/post/?post=${p.slug}" class="related-card">
            <span class="related-card-tag ${c.cssClass}">${c.label}</span>
            <span class="related-card-title">${p.title}</span>
            <span class="related-card-date">${formatDate(p.date)}</span>
          </a>
        `;
      }).join('')}
    </div>
  `;
  container.appendChild(section);
}

function injectRecentPosts(container, posts, currentPost) {
  const recent = posts
    .filter(p => p.slug !== currentPost.slug)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 3);

  if (recent.length === 0) return;

  const section = document.createElement('div');
  section.className = 'recent-posts';
  section.innerHTML = `
    <h3 class="recent-posts-title">Últimos artigos</h3>
    <div class="recent-posts-grid">
      ${recent.map(p => {
        const c = CATEGORY_MAP[p.category] || { label: p.category, cssClass: 'tag-growth' };
        return `
          <a href="/blog/post/?post=${p.slug}" class="recent-card">
            <span class="recent-card-tag ${c.cssClass}">${c.label}</span>
            <span class="recent-card-title">${p.title}</span>
            <span class="recent-card-date">${formatDate(p.date)}</span>
          </a>
        `;
      }).join('')}
    </div>
  `;
  container.appendChild(section);
}

function injectMetaDescription(meta) {
  const existing = document.querySelector('meta[name="description"]');
  if (existing) existing.remove();
  const tag = document.createElement('meta');
  tag.name = 'description';
  tag.content = meta.excerpt;
  document.head.appendChild(tag);
}

function postUrl(slug) {
  return '/blog/post/?post=' + slug;
}

function injectMetaTags(meta) {
  const url = postUrl(meta.slug);
  const origin = window.location.origin;

  const tags = [
    ['link', 'canonical', origin + url],
    ['meta', 'og:type', 'article'],
    ['meta', 'og:url', origin + url],
    ['meta', 'og:title', meta.title + ' — João Gobira'],
    ['meta', 'og:description', meta.excerpt],
    ['meta', 'og:site_name', 'João Gobira'],
    ['meta', 'og:image', origin + '/blog/images/joao-gobira.jpg'],
    ['meta', 'twitter:card', 'summary_large_image'],
    ['meta', 'twitter:title', meta.title],
    ['meta', 'twitter:description', meta.excerpt],
    ['meta', 'twitter:image', origin + '/blog/images/joao-gobira.jpg'],
  ];

  tags.forEach(([el, prop, content]) => {
    const tag = document.createElement(el);
    if (el === 'link') { tag.rel = 'canonical'; tag.href = content; }
    else if (prop.startsWith('og:')) { tag.setAttribute('property', prop); tag.content = content; }
    else { tag.setAttribute('name', prop); tag.content = content; }
    document.head.appendChild(tag);
  });
}

function injectPostSchema(meta, bodyText) {
  const origin = window.location.origin;
  const url = origin + postUrl(meta.slug);

  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "headline": meta.title,
      "description": meta.excerpt,
      "image": origin + "/blog/images/joao-gobira.jpg",
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
        "@id": url
      },
      "wordCount": bodyText.split(/\s+/).length,
      "articleSection": meta.category
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": origin + "/" },
        { "@type": "ListItem", "position": 2, "name": "Blog", "item": origin + "/blog/" },
        { "@type": "ListItem", "position": 3, "name": meta.category, "item": origin + "/blog/?cat=" + meta.category },
        { "@type": "ListItem", "position": 4, "name": meta.title }
      ]
    }
  ];

  schemas.forEach(schema => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  });
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadPostsList();
  loadPost();
});
