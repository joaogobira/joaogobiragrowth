import { Layout } from './types';

export const LAYOUTS: Record<string, Layout> = {

  // ── GRUPO 1: CAPA / COVER ──────────────────────────

  capa_split_vertical: {
    id: 'capa_split_vertical',
    label: 'Capa Split Vertical',
    descricao: 'Foto ocupa 55% direita, texto estruturado na esquerda embaixo. Gradiente esconde a borda da foto. Ideal para capas com foto de pessoa.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['mono-tag', 'accent-line', 'disp-large', 'body', 'badge'],
    html_base: `
<div class="slide" style="background: var(--void);">
  <div class="grain"></div>
  <div class="tape-v fire"></div>
  <div class="tape-h top fire"></div>
  <div class="photo-slot" style="left:42%;right:0;top:0;bottom:0;position:absolute;z-index:1;">
    <img src="{{foto_url}}" style="width:100%;height:100%;object-fit:cover;object-position:center 15%;">
  </div>
  <div style="position:absolute;left:42%;right:0;top:0;bottom:0;z-index:2;
    background:linear-gradient(to right,var(--void) 0%,transparent 30%);"></div>
  <div style="position:absolute;left:42%;right:0;bottom:0;height:50%;z-index:2;
    background:linear-gradient(to bottom,transparent,var(--void));"></div>
  <div class="slide-no">{{numero}}/{{total}}</div>
  <div class="cw" style="padding:96px 0 96px 92px;justify-content:flex-end;width:56%;">
    <div class="mono-tag fire" style="margin-bottom:36px;">{{tag}}</div>
    <div class="h-line fire sm" style="margin-bottom:36px;"></div>
    <div class="disp-large" style="margin-bottom:36px;">{{titulo}}</div>
    <div class="body-copy" style="font-size:34px;margin-bottom:48px;">{{corpo}}</div>
    <div class="author-badge">
      <img src="{{foto_url}}" class="badge-av">
      <div><div class="badge-name">{{autor_nome}}</div><div class="badge-role">{{autor_role}}</div></div>
    </div>
  </div>
</div>`,
  },

  capa_foto_full: {
    id: 'capa_foto_full',
    label: 'Capa Foto Full',
    descricao: 'Foto ocupa 100% do fundo com overlay escuro gradiente. Texto fica no terço inferior. Impactante.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['overlay-dark-bottom', 'mono-tag', 'disp-large', 'body', 'badge'],
    html_base: `
<div class="slide" style="background:var(--void);">
  <div class="grain"></div>
  <div class="tape-v fire"></div>
  <div class="tape-h top fire"></div>
  <img src="{{foto_url}}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 10%;filter:grayscale(15%) brightness(0.35);z-index:1;">
  <div style="position:absolute;inset:0;z-index:2;background:linear-gradient(to bottom,rgba(8,8,8,0.1) 0%,rgba(8,8,8,0.5) 50%,rgba(8,8,8,0.97) 85%,#080808 100%);"></div>
  <div class="slide-no">{{numero}}/{{total}}</div>
  <div class="cw" style="padding:96px 88px 80px 96px;justify-content:flex-end;gap:0;">
    <div class="mono-tag fire" style="margin-bottom:32px;">{{tag}}</div>
    <div class="h-line fire md" style="margin-bottom:36px;"></div>
    <div class="disp-large" style="margin-bottom:32px;">{{titulo}}</div>
    <div class="div-line thick" style="margin-bottom:32px;"></div>
    <div class="body-copy" style="font-size:34px;margin-bottom:48px;">{{corpo}}</div>
    <div class="author-badge">
      <img src="{{foto_url}}" class="badge-av">
      <div><div class="badge-name">{{autor_nome}}</div><div class="badge-role">{{autor_role}}</div></div>
    </div>
  </div>
</div>`,
  },

  capa_foto_circulo: {
    id: 'capa_foto_circulo',
    label: 'Capa Círculo de Foto',
    descricao: 'Foto recortada em círculo com borda colorida. Layout paper/light. Ideal para personal brand.',
    formatos_suportados: ['portrait', 'story'],
    componentes: ['foto-circulo', 'mono-tag', 'disp-large', 'body'],
    html_base: \`\`,
  },

  capa_split_horizontal: {
    id: 'capa_split_horizontal',
    label: 'CTA Split Horizontal',
    descricao: 'Foto ocupa 45% esquerda, conteúdo CTA ocupa 55% direita. Usado geralmente no último slide.',
    formatos_suportados: ['portrait', 'story'],
    componentes: ['foto-half', 'disp-medium', 'body', 'btn-solid'],
    html_base: \`\`,
  },

  // ── GRUPO 2: CONTEÚDO / BODY ──────────────────────

  numbered_list_dark: {
    id: 'numbered_list_dark',
    label: 'Lista Numerada Dark',
    descricao: 'Lista de 3-5 itens com número grande em destaque. Fundo escuro. Borda separadora entre items.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['mono-tag', 'disp-medium', 'num-list'],
    html_base: \`\`,
  },

  numbered_list_paper: {
    id: 'numbered_list_paper',
    label: 'Lista Numerada Paper',
    descricao: 'Itens em containers dark sobre fundo paper bege. Borda fire na esquerda. Número em vermelho.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['mono-tag', 'disp-large', 'ni-paper'],
    html_base: \`\`,
  },

  stat_gigante: {
    id: 'stat_gigante',
    label: 'Número Gigante',
    descricao: 'Número enorme (ex: +47%, 165K) ocupa a maior parte do slide. Usado para dados de impacto.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['stat-huge', 'mono-tag', 'body', 'div-line'],
    html_base: \`\`,
  },

  quote_pull: {
    id: 'quote_pull',
    label: 'Quote Pull',
    descricao: 'Citação com aspas gigantes em marca d\\'água. Fundo escuro. Badge do autor embaixo.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['quote-mark-bg', 'disp-medium', 'badge'],
    html_base: \`\`,
  },

  foto_half_top: {
    id: 'foto_half_top',
    label: 'Foto Metade Superior',
    descricao: 'Foto ocupa metade superior, texto preenche metade inferior. Linha separadora fire. Funciona bem em light e dark.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['foto-half-top', 'mono-tag', 'disp-medium', 'body'],
    html_base: \`\`,
  },

  vs_split: {
    id: 'vs_split',
    label: 'VS / Comparação',
    descricao: 'Dois blocos lado a lado: problema (escuro) vs solução (borda fire). Listas de bullets em cada coluna.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['vs-col-bad', 'vs-col-good', 'disp-medium'],
    html_base: \`\`,
  },

  foto_topo_vs: {
    id: 'foto_topo_vs',
    label: 'Foto Topo + VS Embaixo',
    descricao: 'Foto ocupa 40% superior com overlay, linha fire separa, VS split embaixo.',
    formatos_suportados: ['portrait'],
    componentes: ['foto-top-overlay', 'vs-split'],
    html_base: \`\`,
  },

  bento_metricas: {
    id: 'bento_metricas',
    label: 'Bento Grid Métricas',
    descricao: 'Grid 2x2 ou 3 células com números grandes. Uma célula span 2 colunas com o dado principal.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['bento-2x2', 'stat-num', 'mono-tag'],
    html_base: \`\`,
  },

  icon_grid: {
    id: 'icon_grid',
    label: 'Icon Grid 2×2',
    descricao: 'Grade 2x2 com emoji/ícone, título e descrição em cada célula. Divisores de 1px entre células.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['icon-cell-2x2', 'disp-medium'],
    html_base: \`\`,
  },

  checklist: {
    id: 'checklist',
    label: 'Checklist',
    descricao: 'Lista de itens com checkbox quadrado. Itens marcados riscados. Itens pendentes com checkbox vazio.',
    formatos_suportados: ['portrait', 'story'],
    componentes: ['check-item-checked', 'check-item-empty', 'disp-medium'],
    html_base: \`\`,
  },

  timeline: {
    id: 'timeline',
    label: 'Timeline',
    descricao: 'Linha do tempo vertical com dots fire e linha conectando. Cada item tem data/período, título e descrição.',
    formatos_suportados: ['portrait'],
    componentes: ['tl-item', 'tl-dot', 'tl-line', 'mono-tag'],
    html_base: \`\`,
  },

  testimonial: {
    id: 'testimonial',
    label: 'Depoimento / Testimonial',
    descricao: 'Um ou dois depoimentos empilhados. Estrelas douradas, texto, nome e empresa. Container escuro sobre fundo carbon.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['testimonial-card', 'stars', 'mono-tag'],
    html_base: \`\`,
  },

  score_bars: {
    id: 'score_bars',
    label: 'Barras de Progresso / Score',
    descricao: 'Múltiplas barras de progresso mostrando percentuais. Útil para diagnósticos, comparações antes/depois.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['score-track', 'score-fill', 'score-label'],
    html_base: \`\`,
  },

  // ── GRUPO 3: GRÁFICOS SVG ─────────────────────────

  chart_barras_horizontal: {
    id: 'chart_barras_horizontal',
    label: 'Gráfico Barras Horizontais',
    descricao: 'Barras horizontais SVG com labels, valores e grid lines. A barra em destaque usa --fire, as demais usam --steel.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['svg-hbar', 'container-dark'],
    svg_template: \`
<svg viewBox="0 0 680 {{altura}}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;">
  <!-- Grid line vertical -->
  <line x1="180" y1="0" x2="180" y2="{{altura}}" stroke="#2a2a2a" stroke-width="1"/>
  {{#each dados}}
  <text x="170" y="{{this.y_label}}" text-anchor="end" fill="{{this.cor_label}}" font-family="Barlow,sans-serif" font-size="20" font-weight="300">{{this.label}}</text>
  <rect x="184" y="{{this.y_bar}}" width="{{this.largura}}" height="28" fill="{{this.cor_bar}}" rx="2"/>
  <text x="{{this.x_val}}" y="{{this.y_label}}" fill="{{this.cor_val}}" font-family="Space Mono,monospace" font-size="18">{{this.valor_display}}</text>
  {{/each}}
</svg>\`,
    html_base: \`\`,
  },

  chart_linha_tendencia: {
    id: 'chart_linha_tendencia',
    label: 'Gráfico Linha de Tendência',
    descricao: 'Linha SVG com área fill e gradiente. Pontos de dados, grid lines, labels de eixo X e Y. Ponto atual em destaque.',
    formatos_suportados: ['portrait', 'square'],
    componentes: ['svg-line-chart', 'svg-area-fill', 'container-dark'],
    html_base: \`\`,
  },

  chart_donut: {
    id: 'chart_donut',
    label: 'Gráfico Donut / Pizza',
    descricao: 'SVG donut chart mostrando duas fatias (ex: perdido vs recuperado). Label central com percentual. Legenda lateral.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['svg-donut', 'container-dark'],
    html_base: \`\`,
  },

  // ── GRUPO 4: CTA / OFERTA ─────────────────────────

  cta_simples: {
    id: 'cta_simples',
    label: 'CTA Simples',
    descricao: 'Slide de encerramento com pergunta de engajamento ou call to action. Foto fundo com overlay muito escuro.',
    formatos_suportados: ['portrait', 'square', 'story'],
    componentes: ['foto-bg-dark', 'disp-medium', 'div-line', 'body'],
    html_base: \`\`,
  },

  cta_price_offer: {
    id: 'cta_price_offer',
    label: 'CTA Preço / Oferta',
    descricao: 'Bloco de preço com "de por", valor grande, lista de features com checkmark fire, botão CTA sólido.',
    formatos_suportados: ['portrait', 'story'],
    componentes: ['price-block', 'price-features', 'btn-solid'],
    html_base: \`\`,
  },

  // ── GRUPO 5: BANNERS / LANDSCAPE ──────────────────

  banner_split_dark: {
    id: 'banner_split_dark',
    label: 'Banner Split Dark',
    descricao: 'Texto ocupa 55% esquerda, bloco fire com stat ocupa 45% direita com clip-path diagonal.',
    formatos_suportados: ['landscape', 'banner'],
    componentes: ['text-left', 'stat-block-fire', 'clip-path-diagonal'],
    html_base: \`\`,
  },

  banner_foto_produto: {
    id: 'banner_foto_produto',
    label: 'Banner Foto + Lista Features',
    descricao: 'Foto 45% esquerda, lista de features com checkmark na direita. Ideal para produto/serviço.',
    formatos_suportados: ['landscape', 'banner'],
    componentes: ['foto-half', 'feature-list', 'mono-tag'],
    html_base: \`\`,
  },

  banner_paper_awareness: {
    id: 'banner_paper_awareness',
    label: 'Banner Paper Awareness',
    descricao: 'Fundo paper, foto direita com linha fire separando, texto bold à esquerda. Tom editorial.',
    formatos_suportados: ['landscape', 'banner'],
    componentes: ['foto-right-paper', 'disp-large', 'mono-tag'],
    html_base: \`\`,
  },

  youtube_thumbnail: {
    id: 'youtube_thumbnail',
    label: 'YouTube Thumbnail',
    descricao: 'Foto 44% esquerda, pills coloridos empilhados + headline grande + label. Estilo chocante/curioso.',
    formatos_suportados: ['landscape'],
    componentes: ['foto-left', 'pill-stack', 'disp-large', 'label-small'],
    html_base: \`\`,
  },

  // ── GRUPO 6: STORY/REEL EXCLUSIVOS ────────────────

  story_progresso: {
    id: 'story_progresso',
    label: 'Story com Progress Bar',
    descricao: 'Barra de progresso de stories no topo (branca). Foto full fundo escuro. Swipe indicator no rodapé.',
    formatos_suportados: ['story'],
    componentes: ['progress-bar-stories', 'foto-full', 'swipe-indicator'],
    html_base: \`\`,
  },

  story_numero_fire: {
    id: 'story_numero_fire',
    label: 'Story Número Fire',
    descricao: 'Fundo fire sólido. Número gigante em transparência no fundo. Stat em destaque + mini bento grid 2x2.',
    formatos_suportados: ['story'],
    componentes: ['bg-fire', 'number-bg-huge', 'stat-main', 'bento-mini'],
    html_base: \`\`,
  },

  story_split_lateral: {
    id: 'story_split_lateral',
    label: 'Story Split Lateral',
    descricao: 'Foto 45% esquerda com linha fire separando. Texto estruturado 55% direita. Badge foto na base.',
    formatos_suportados: ['story'],
    componentes: ['foto-left-story', 'mono-tag', 'disp-medium', 'body', 'badge-compact'],
    html_base: \`\`,
  },

} as const;
