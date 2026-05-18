/**
 * Studio Server — João Gobira Growth
 * Servidor local para o painel visual de exportação de criativos.
 * Porta: 3001
 */

require('dotenv').config({ override: true, path: require('path').join(__dirname, '.env') });


const express = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const axios = require('axios');

// ── Cloudinary ─────────────────────────────────────────────────────────────
let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} catch(e) { console.log('  ⚠ Cloudinary não instalado. Rode: npm install cloudinary'); }

// ── Fila local ─────────────────────────────────────────────────────────────
const QUEUE_FILE = path.join(__dirname, 'queue.json');
const readQueue  = () => fs.existsSync(QUEUE_FILE) ? JSON.parse(fs.readFileSync(QUEUE_FILE,'utf8')) : [];
const writeQueue = (q) => fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));

const app = express();
const PORT = 3001;
const BASE_DIR = __dirname;

// Mapeamento de classes CSS → dimensões de exportação
const FORMAT_MAP = {
  'ad-square':   { w: 1080, h: 1080,  label: 'Meta Ads 1:1',       platform: 'meta' },
  'ad-portrait': { w: 1080, h: 1350,  label: 'Meta Ads 4:5',       platform: 'meta' },
  'ad-story':    { w: 1080, h: 1920,  label: 'Story / Reel 9:16',  platform: 'meta' },
  'yt-thumb':    { w: 1280, h: 720,   label: 'YouTube Thumbnail',  platform: 'youtube' },
  'yt-banner':   { w: 2560, h: 1440,  label: 'YouTube Banner',     platform: 'youtube' },
  'yt-short':    { w: 1080, h: 1920,  label: 'YouTube Shorts',     platform: 'youtube' },
  'logo-asset':  { w: null, h: null,  label: 'Logo / Marca',       platform: 'brand' },
  'banner':      { w: null, h: null,  label: 'Banner Campanha',    platform: 'brand' },
  'slide':       { w: 1080, h: 1350,  label: 'Carrossel Feed',     platform: 'carousel' },
};

// Plataforma → ícone e cor
const PLATFORM_META = {
  instagram: { icon: '📸', color: '#C8391A', label: 'Instagram' },
  linkedin:  { icon: '💼', color: '#0077B5', label: 'LinkedIn'  },
  meta:      { icon: '📢', color: '#1877F2', label: 'Meta Ads'  },
  youtube:   { icon: '▶️',  color: '#FF0000', label: 'YouTube'   },
  brand:     { icon: '🎨', color: '#B8922A', label: 'Marca'     },
  carousel:  { icon: '🗂️',  color: '#C8391A', label: 'Carrossel' },
};

// Pastas de criativos a varrer (relativo a BASE_DIR)
const CREATIVE_DIRS = [
  { folder: path.join(BASE_DIR, 'Carrosseis', 'Instagram'), platform: 'instagram' },
  { folder: path.join(BASE_DIR, 'Carrosseis', 'LinkedIn'),  platform: 'linkedin'  },
  { folder: path.join(BASE_DIR, 'Criativos', 'MetaAds'),   platform: 'meta'      },
  { folder: path.join(BASE_DIR, 'Criativos', 'YouTube'),   platform: 'youtube'   },
  { folder: path.join(BASE_DIR, 'Criativos', 'Logo'),      platform: 'brand'     },
  { folder: path.join(BASE_DIR, 'Criativos', 'Banners'),   platform: 'brand'     },
];

// NOTA: express.static registrado DEPOIS das rotas para não sobrescrever a raiz
app.use(express.json());

// ── API: lista todos os criativos ──────────────────────────────────────────
app.get('/api/criativos', (req, res) => {
  const result = [];

  for (const { folder, platform } of CREATIVE_DIRS) {
    if (!fs.existsSync(folder)) continue;

    const files = fs.readdirSync(folder).filter(f => f.endsWith('.html'));
    for (const file of files) {
      const fullPath = path.join(folder, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Detecta formatos presentes no HTML
      const formats = [];
      for (const [cls, fmt] of Object.entries(FORMAT_MAP)) {
        if (content.includes(`class="${cls}"`) || content.includes(`"${cls} `) || content.includes(` ${cls}"`)) {
          formats.push({ class: cls, ...fmt });
        }
      }
      // fallback: se tem .slide, é carrossel
      if (formats.length === 0 && content.includes('class="slide"')) {
        formats.push({ class: 'slide', ...FORMAT_MAP['slide'] });
      }
      if (formats.length === 0) {
        formats.push({ class: 'slide', ...FORMAT_MAP['slide'] });
      }

      // Conta slides exportados (pasta _slides)
      const baseName = file.replace('.html', '');
      const slidesDir = path.join(folder, baseName + '_slides');
      const exportedSlides = fs.existsSync(slidesDir)
        ? fs.readdirSync(slidesDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg')).length
        : 0;

      const stat = fs.statSync(fullPath);

      result.push({
        id: Buffer.from(fullPath).toString('base64'),
        name: baseName.replace(/_/g, ' '),
        filename: file,
        platform,
        folder: path.relative(BASE_DIR, folder),
        fullPath,
        relativePath: path.relative(BASE_DIR, fullPath).replace(/\\/g, '/'),
        formats,
        exportedSlides,
        slidesDir: slidesDir,
        modifiedAt: stat.mtime,
      });
    }
  }

  res.json(result);
});

// ── API: conta slides de um HTML ───────────────────────────────────────────
app.get('/api/slide-count', async (req, res) => {
  const { file } = req.query;
  if (!file) return res.json({ count: 0 });

  try {
    const content = fs.readFileSync(file, 'utf8');
    // Conta ocorrências de class="slide", class="ad-square", etc.
    const slideClasses = ['slide', 'ad-square', 'ad-portrait', 'ad-story', 'yt-thumb', 'yt-banner', 'yt-short', 'logo-asset', 'banner'];
    let count = 0;
    for (const cls of slideClasses) {
      const matches = content.match(new RegExp(`class="${cls}"`, 'g'));
      if (matches) count += matches.length;
    }
    res.json({ count });
  } catch (e) {
    res.json({ count: 0 });
  }
});

// ── API: lista slides exportados de um criativo ────────────────────────────
app.get('/api/slides-exportados', (req, res) => {
  const { dir } = req.query;
  if (!dir || !fs.existsSync(dir)) return res.json({ slides: [] });

  const slides = fs.readdirSync(dir)
    .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
    .sort()
    .map(f => ({
      filename: f,
      relativePath: path.relative(BASE_DIR, path.join(dir, f)).replace(/\\/g, '/'),
    }));

  res.json({ slides });
});

// ── API: exportar um criativo ──────────────────────────────────────────────
app.post('/api/exportar', async (req, res) => {
  const { file } = req.body;
  if (!file || !fs.existsSync(file)) {
    return res.status(400).json({ error: 'Arquivo não encontrado' });
  }

  // Seta headers para streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: 'start', message: 'Iniciando exportação...' });

  try {
    const puppeteer = require('puppeteer-core');
    const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

    const browser = await puppeteer.launch({
      executablePath: EDGE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
    });

    const page = await browser.newPage();
    const fullPath = path.resolve(file).replace(/\\/g, '/');
    await page.goto(`file:///${fullPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    // Detect all slide-like elements
    const slideSelectors = ['.slide', '.ad-square', '.ad-portrait', '.ad-story', '.yt-thumb', '.yt-banner', '.yt-short', '.logo-asset', '.banner'];

    // Remove transforms for native-res screenshot
    await page.evaluate((selectors) => {
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach(el => {
          el.style.transform = 'none';
          el.style.marginBottom = '0';
          el.style.marginRight = '0';
        });
      }
      document.body.style.gap = '20px';
      document.body.style.padding = '0';
    }, slideSelectors);

    await page.setViewport({ width: 2600, height: 2600, deviceScaleFactor: 1 });

    // Collect all slide elements
    let allSlides = [];
    for (const sel of slideSelectors) {
      const found = await page.$$(sel);
      allSlides = allSlides.concat(found);
    }

    if (allSlides.length === 0) {
      send({ type: 'error', message: 'Nenhum slide encontrado no arquivo.' });
      await browser.close();
      res.end();
      return;
    }

    const dir = path.dirname(path.resolve(file));
    const baseName = path.basename(file, '.html');
    const outputDir = path.join(dir, baseName + '_slides');
    fs.mkdirSync(outputDir, { recursive: true });

    send({ type: 'progress', message: `${allSlides.length} slides encontrados`, total: allSlides.length, current: 0 });

    for (let i = 0; i < allSlides.length; i++) {
      const outputPath = path.join(outputDir, `slide_${String(i + 1).padStart(2, '0')}.png`);
      await allSlides[i].screenshot({ path: outputPath });
      const relPath = path.relative(BASE_DIR, outputPath).replace(/\\/g, '/');
      send({ type: 'slide', index: i + 1, total: allSlides.length, path: relPath });
    }

    await browser.close();
    send({ type: 'done', total: allSlides.length, outputDir: path.relative(BASE_DIR, outputDir).replace(/\\/g, '/') });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }

  res.end();
});

// ── API: abre pasta no Explorer ────────────────────────────────────────────
app.post('/api/abrir-pasta', (req, res) => {
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: 'Diretório não informado' });
  const fullDir = path.isAbsolute(dir) ? dir : path.join(BASE_DIR, dir);
  execFile('explorer.exe', [fullDir]);
  res.json({ ok: true });
});

// ── PUBLICAR: Upload para Cloudinary ──────────────────────────────────────
app.post('/api/publicar/upload', async (req, res) => {
  const cld = require('cloudinary').v2;
  // vestauth injeta process.env corretamente do .env — usar direto
  cld.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log('[Cloud] name:', process.env.CLOUDINARY_CLOUD_NAME, '| key:', process.env.CLOUDINARY_API_KEY?.slice(0,6));
  const { files } = req.body;
  try {
    const urls = [];
    for (const file of files) {
      const result = await cld.uploader.upload(file, { folder: 'joao-gobira-studio', use_filename: true });
      urls.push({ file, url: result.secure_url });
    }
    res.json({ ok: true, urls });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PUBLICAR: Publicar no Instagram (direto via graph.instagram.com) ────────
app.post('/api/publicar/instagram', async (req, res) => {
  const { urls, caption } = req.body;

  // Lê token direto do studio.config (bypass vestauth)
  const cfgLines = fs.readFileSync(path.join(BASE_DIR, 'studio.config'), 'utf8').split(/\r?\n/);
  const cfg = {};
  cfgLines.forEach(l => { const t=l.trim(); if(!t||t[0]==='#') return; const eq=t.indexOf('='); if(eq<0) return; cfg[t.slice(0,eq).trim()]=t.slice(eq+1).trim(); });
  const TOKEN = cfg.IG_ACCESS_TOKEN;

  if (!TOKEN) return res.status(400).json({ error: 'IG_ACCESS_TOKEN não configurado no studio.config' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

  const BASE  = 'https://graph.instagram.com/v25.0';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const ig = async (endpoint, params) => {
    const r = await axios.post(`${BASE}${endpoint}`, null, { params: { ...params, access_token: TOKEN } });
    if (r.data.error) throw new Error(`[Meta] ${r.data.error.message}`);
    return r.data;
  };

  // Aguarda container estar FINISHED antes de usar no carrossel
  const aguardarPronto = async (containerId, tentativas = 10) => {
    for (let i = 0; i < tentativas; i++) {
      await sleep(3000);
      const r = await axios.get(`${BASE}/${containerId}`, { params: { fields: 'status_code', access_token: TOKEN } });
      const status = r.data.status_code;
      if (status === 'FINISHED') return true;
      if (status === 'ERROR') throw new Error(`Container ${containerId} com erro no processamento`);
    }
    throw new Error('Timeout: imagem demorou demais para processar');
  };

  try {
    send({ type: 'step', msg: `Criando ${urls.length} itens de mídia...` });
    const itemIds = [];
    for (let i = 0; i < urls.length; i++) {
      const item = await ig('/me/media', { image_url: urls[i], is_carousel_item: true });
      send({ type: 'step', msg: `  Imagem ${i+1}/${urls.length} criada. Aguardando processamento...` });
      await aguardarPronto(item.id);
      itemIds.push(item.id);
    }

    // Espera 3 segundos para propagação dos itens filhos
    await sleep(3000);

    send({ type: 'step', msg: 'Montando carrossel...' });
    const carousel = await ig('/me/media', { media_type: 'CAROUSEL', children: itemIds.join(','), caption });
    
    send({ type: 'step', msg: 'Aguardando processamento do carrossel (5s)...' });
    await sleep(5000);

    send({ type: 'step', msg: 'Publicando...' });
    const pub = await ig('/me/media_publish', { creation_id: carousel.id });

    send({ type: 'done', postId: pub.id });
  } catch(e) {
    const msg = e.response?.data?.error?.message || e.message;
    console.error('[Instagram]', msg);
    send({ type: 'error', msg });
  }
  res.end();
});

// ── PUBLICAR: Fila ─────────────────────────────────────────────────────────
app.get('/api/publicar/fila', (req, res) => res.json(readQueue()));
app.post('/api/publicar/fila', (req, res) => {
  const q = readQueue();
  const item = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString() };
  q.push(item); writeQueue(q);
  res.json({ ok: true, item });
});
app.delete('/api/publicar/fila/:id', (req, res) => {
  writeQueue(readQueue().filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

// ── CO-CRIADOR IA ──────────────────────────────────────────────────────────
const readConfig = () => {
  const cfgPath = path.join(BASE_DIR, 'studio.config');
  if (!fs.existsSync(cfgPath)) return {};
  const cfgLines = fs.readFileSync(cfgPath, 'utf8').split(/\r?\n/);
  const cfg = {};
  cfgLines.forEach(l => {
    const t = l.trim();
    if (!t || t[0] === '#') return;
    const eq = t.indexOf('=');
    if (eq < 0) return;
    cfg[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  });
  return cfg;
};

// Retorna as imagens válidas no diretório Carrosseis
const getBibliotecaImagens = () => {
  try {
    const dirPath = path.join(BASE_DIR, 'Carrosseis');
    if (!fs.existsSync(dirPath)) return [];
    const files = fs.readdirSync(dirPath);
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    return files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      const stats = fs.statSync(path.join(dirPath, f));
      return stats.isFile() && validExtensions.includes(ext);
    });
  } catch (e) {
    return [];
  }
};

// Endpoint da Biblioteca de Imagens
app.get('/api/ia/biblioteca', (req, res) => {
  res.json({ ok: true, imagens: getBibliotecaImagens() });
});

app.post('/api/ia/chat', async (req, res) => {
  const { message, history, format = 'carousel' } = req.body;
  const cfg = readConfig();
  const apiKey = cfg.GEMINI_API_KEY;
 
  if (!apiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY não configurada no studio.config' });
  }

  const listaImagens = getBibliotecaImagens();
  const imagensStr = listaImagens.length > 0 
    ? `Lista de arquivos de imagens físicas disponíveis na sua pasta Carrosseis/:\n${listaImagens.map(i => `- "${i}"`).join('\n')}`
    : 'Nenhuma imagem física cadastrada. Use fundo sólido.';

  const systemInstruction = `Você é o co-criador oficial de criativos de João Gobira, especialista em Growth, Gestão e Marketing de Performance.
Seu objetivo é gerar a copy e estrutura de slides de um criativo brutalista de alta conversão.

FORMATO DO CRIATIVO SOLICITADO: "${format}"
Considere as diretrizes do formato solicitado para compor títulos e copys:
- "carousel": Carrossel do Instagram (1080x1350px). Média de 5 a 10 slides. Texto fluido, bem sequenciado.
- "square": Feed quadrado/Meta Ads (1080x1080px). Criativo único ou carrossel quadrado. Foco em copy extremamente visual e direta.
- "vertical": Stories / Reels (1080x1920px). Proporção vertical. Máximo 1 slide de roteiro ultra impactante ou sequência rápida de 3-4 slides para Stories.
- "horizontal": Banner / Linkedin JG (1920x1080px). Proporção horizontal. Títulos bem amplos em uma linha e parágrafos distribuídos horizontalmente.

DIRETRIZES DE MARCA (João Gobira):
- Tom de Voz: Direto, firme, com peso emocional e autoridade. Tom nascido da trincheira, do campo de batalha real de growth, e não de teorias corporativas vazias.
- Use metáforas ocasionais de Jiu-Jitsu, tatame, resiliência sob pressão e sobrevivência.
- NUNCA use clichês corporativos como: "disruptivo", "innovador", "inovador", "potencializar resultados", "jornada de aprendizado", "entrega de valor", "ecossistema".
- Use números e dados específicos (ex: "47% de aumento em vendas" ao invés de "resultado expressivo").
- Fale para fundadores e gestores que precisam de método e dados.

REGRAS DE IMAGENS & FOTOGRAFIAS:
${imagensStr}

A sua escolha de imagem para o campo "bg" deve ser altamente estratégica e lógica com base no teor do slide:
- Use preferencialmente "joao-gobira.JPG" para Capa e CTA.
- Use "IMG_7386.JPG" (tatame/luta) se o slide falar sobre disciplina, Jiu-Jitsu, resiliência, luta diária ou sob pressão.
- Use "IMG_7392.JPG" (palco/palestra) se o slide falar sobre autoridade, ensinar equipes, palestras, mentorias, liderança e escala.
- Use "IMG_7397.JPG" (executivo/negócios) se o slide falar sobre reuniões, fechamentos de contrato, finanças corporativas e o lado corporativo de growth.
- Use "DSC08278.png" (action/trabalho) se o slide falar sobre execução operacional, "colocar a mão na massa", tráfego, código ou análises em tempo real.
- Use "WhatsApp Image 2026-02-18 at 08.30.57.jpeg" especificamente para fundos de CTA convidando para falar no WhatsApp ou agendamentos.
- Se o slide requerer foco puramente textual (como uma tabela ou citação direta), deixe o campo "bg" vazio "" para fundo sólido.

REGRAS DE LAYOUT DOS SLIDES:
1. Capa (Slide 1): Título impactante (Bebas Neue, use <em> para destacar em vermelho, ex: "3 LIÇÕES DO<br><em>JIU-JITSU</em>") + Subtítulo de apoio curto. A tag deve ser o tema central (maiúsculas, ex: "GROWTH NÚMEROS").
2. Slides Internos: Uma ideia central por slide.
   - Devem conter uma "tag" curta (maiúsculas), um "title" forte (Bebas Neue) e um "body" (Barlow Light).
   - O corpo do texto pode ter até 2 parágrafos curtos.
3. Slide de Métrica/Destaque: Deve conter um número ou estatística bem destacada no título e explicada.
4. Slide de Frase/Quote: Deve conter uma frase curta e impactante estilo citação (Bebas Neue).
5. Slide CTA Final (Último Slide): Um convite à ação urgente.

FORMATO DE RESPOSTA (OBRIGATÓRIO):
Você DEVE responder UNICAMENTE com um objeto JSON estruturado contendo a lista de slides gerada, seguindo exatamente o formato abaixo:
{
  "assistantMessage": "Uma mensagem de introdução curta e inspiradora sobre o criativo gerado no estilo João Gobira.",
  "slides": [
    {
      "type": "capa",
      "tag": "CATEGORIA DO CONTEÚDO",
      "title": "TÍTULO DA CAPA<br>COM <em>DESTAQUE</em>",
      "body": "Subtítulo de apoio complementar.",
      "bg": "joao-gobira.JPG"
    },
    {
      "type": "dor",
      "tag": "O PROBLEMA",
      "title": "TÍTULO DA DOR",
      "body": "Texto descrevendo a dor do leitor...",
      "bg": ""
    },
    {
      "type": "cta",
      "tag": "AÇÃO",
      "title": "CHAMADA FINAL",
      "body": "Texto do botão ou convite...",
      "bg": "joao-gobira.JPG"
    }
  ]
}

Importante: Retorne APENAS o JSON puro. Não inclua blocos de código markdown ou texto explicativo fora do JSON.`;

  const contents = [];
  if (history && history.length > 0) {
    history.forEach(h => {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }]
      });
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: message }]
  });

  const payload = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const models = ['gemini-3-flash-preview', 'gemini-1.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[Gemini] Tentando modelo ${model} (formato: ${format})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(url, payload, { timeout: 30000 });
      const text = response.data.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(text.trim());
      return res.json({ ok: true, model, ...parsed });
    } catch (err) {
      lastError = err;
      console.error(`[Gemini] Falha no modelo ${model}:`, err.response?.data?.error?.message || err.message);
    }
  }

  res.status(500).json({ error: `Falha ao conectar com o Gemini: ${lastError?.response?.data?.error?.message || lastError?.message}` });
});

app.post('/api/ia/salvar-criativo', (req, res) => {
  const { name, slides, format = 'carousel' } = req.body;
  if (!name || !slides || slides.length === 0) {
    return res.status(400).json({ error: 'Dados insuficientes' });
  }

  let width = 1080;
  let height = 1350;
  let scale = 0.38;

  if (format === 'square') {
    width = 1080;
    height = 1080;
  } else if (format === 'vertical') {
    width = 1080;
    height = 1920;
  } else if (format === 'horizontal') {
    width = 1920;
    height = 1080;
    scale = 0.25;
  }

  const marginBottom = Math.round(-height * (1 - scale)) + 12;

  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `criativo_ia_${sanitized}_${Date.now()}.html`;
  const targetPath = path.join(BASE_DIR, 'Carrosseis', 'Instagram', filename);

  let slidesHtml = '';
  slides.forEach((s, idx) => {
    const slideNo = `${String(idx + 1).padStart(2, '0')}/${String(slides.length).padStart(2, '0')}`;
    const bgUrl = s.bg ? `../${s.bg}` : '';
    
    let isCapa = s.type === 'capa';
    let isCta = s.type === 'cta';
    let isQuote = s.type === 'quote';

    slidesHtml += `\n<!-- SLIDE ${idx + 1}: ${s.type.toUpperCase()} -->\n`;
    
    if (isCapa) {
      slidesHtml += `<div class="slide" id="slide-${idx + 1}">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>

  <div class="split-bg" style="background-image: url('${bgUrl}'); filter: grayscale(30%) contrast(1.1) brightness(0.9);"></div>
  <div class="split-gradient"></div>
  <div class="split-gradient-bottom"></div>

  <div class="slide-no">${slideNo}</div>

  <div class="cw" style="width: 55%; padding-right: 0; justify-content: flex-end; padding-bottom: 140px; gap: 0;">
    <div class="mono-tag" style="margin-bottom: 40px;">${s.tag || 'GROWTH EXECUÇÃO'}</div>
    <div class="h-line h-line-fire"></div>

    <div class="disp-large" style="font-size: 116px; line-height: 0.88; margin-bottom: 44px;">
      ${s.title}
    </div>

    <div class="body-copy" style="font-size: 34px;">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isCta) {
      slidesHtml += `<div class="slide" id="slide-${idx + 1}" style="background: var(--void);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-bottom tape-h-fire"></div>

  <div class="photo-bg" style="background-image: url('${bgUrl || '../joao-gobira.JPG'}'); background-position: center 10%; filter: grayscale(20%) brightness(0.35);"></div>
  <div class="photo-overlay"></div>

  <div class="slide-no">${slideNo}</div>

  <div class="cw" style="justify-content: center; text-align: center; align-items: center; padding-top: 160px; gap: 0;">
    <div class="mono-tag" style="margin-bottom: 40px;">${s.tag || 'O JOGO DA EXECUÇÃO'}</div>
    
    <div class="disp-medium" style="font-size: 96px; margin-bottom: 44px; line-height: 0.92;">
      ${s.title}
    </div>

    <div class="body-copy" style="text-align: center; max-width: 800px; color: var(--bone);">
      ${s.body}
    </div>
  </div>
</div>\n`;
    } else if (isQuote) {
      slidesHtml += `<div class="slide" id="slide-${idx + 1}" style="background: var(--carbon);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="slide-no">${slideNo}</div>

  <div class="cw" style="justify-content: center; gap: 0;">
    <div class="mono-tag" style="margin-bottom: 48px;">${s.tag || 'CITAÇÃO'}</div>
    <div class="h-line h-line-fire"></div>

    <div style="margin-bottom: 32px;"><div class="quote-mark">"</div></div>

    <div class="quote-text" style="font-size: 80px; line-height: 0.94; margin-bottom: 48px;">
      ${s.title}
    </div>

    <div class="body-copy" style="font-size: 42px; border-top: 2px solid var(--iron); padding-top: 40px;">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else {
      const isGold = s.type === 'metrica' || s.type === 'solucao';
      const tapeClass = isGold ? 'tape-v-gold' : 'tape-v-fire';
      const lineClass = isGold ? 'h-line-gold' : 'h-line-fire';
      const tagClass = isGold ? 'mono-tag gold' : 'mono-tag';

      slidesHtml += `<div class="slide" id="slide-${idx + 1}" style="background: ${bgUrl ? 'transparent' : 'var(--void)'};">
  <div class="grain"></div>
  <div class="tape-v ${tapeClass}"></div>
  <div class="slide-no">${slideNo}</div>

  ${bgUrl ? `<div class="photo-bg" style="background-image: url('${bgUrl}'); filter: grayscale(40%) contrast(1.1) brightness(0.45);"></div><div class="photo-overlay-mid"></div>` : ''}

  <div class="cw" style="justify-content: center; gap: 0;">
    <div class="${tagClass}" style="margin-bottom: 32px;">${s.tag || s.type.toUpperCase()}</div>
    <div class="h-line ${lineClass}"></div>

    <div class="disp-medium" style="margin-bottom: 48px;">
      ${s.title}
    </div>

    <div class="body-copy" style="font-size: 42px; border-top: 2px solid var(--iron); padding-top: 40px;">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    }
  });

  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

:root {
  --void:   #080808;
  --carbon: #101010;
  --iron:   #1A1A1A;
  --steel:  #272727;
  --fire:   #C8391A;
  --gold:   #B8922A;
  --bone:   #F0EBE0;
  --muted:  #7A746C;
  --text:   #EDE8E0;
  --sub:    #9A9490;
  --fd: 'Bebas Neue', sans-serif;
  --fc: 'Barlow Condensed', sans-serif;
  --fb: 'Barlow', sans-serif;
  --fm: 'Space Mono', monospace;
}

body {
  background: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
}

.preview-info {
  font-family: var(--fm);
  font-size: 11px;
  letter-spacing: 2px;
  color: #444;
  text-align: center;
  margin-bottom: 32px;
  text-transform: uppercase;
}

.slide {
  width: ${width}px;
  height: ${height}px;
  background: var(--void);
  position: relative;
  flex-shrink: 0;
  transform: scale(${scale});
  transform-origin: top center;
  margin-bottom: ${marginBottom}px;
  overflow: hidden;
  border: 1px solid #222;
}

.sep { width: 411px; height: 2px; background: #222; margin: 0 auto; position: relative; z-index: 99; }

.grain {
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 50;
  opacity: 0.7;
  mix-blend-mode: overlay;
}

.photo-bg {
  position: absolute;
  inset: 0;
  z-index: 1;
  background-size: cover;
  background-position: center top;
}

.photo-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: linear-gradient(
    to bottom,
    rgba(8,8,8,0.2) 0%,
    rgba(8,8,8,0.45) 35%,
    rgba(8,8,8,0.88) 65%,
    rgba(8,8,8,0.98) 100%
  );
}

.photo-overlay-mid {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: linear-gradient(
    to bottom,
    rgba(8,8,8,0.5) 0%,
    rgba(8,8,8,0.3) 50%,
    rgba(8,8,8,0.95) 80%,
    rgba(8,8,8,1) 100%
  );
}

.split-bg {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 50%;
  background-size: cover;
  background-position: center top;
  z-index: 1;
  border-left: 2px solid var(--steel);
}
.split-gradient {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 50%;
  background: linear-gradient(to right, var(--void) 0%, rgba(8,8,8,0) 25%);
  z-index: 2;
}
.split-gradient-bottom {
  position: absolute;
  bottom: 0; right: 0; width: 50%; height: 50%;
  background: linear-gradient(to bottom, rgba(8,8,8,0) 0%, var(--void) 100%);
  z-index: 3;
}

.tape-v { position: absolute; left: 0; top: 0; bottom: 0; width: 5px; z-index: 10; }
.tape-v-fire { background: var(--fire); }
.tape-v-gold { background: var(--gold); }

.tape-h { position: absolute; left: 0; right: 0; height: 4px; z-index: 10; }
.tape-h-top { top: 0; }
.tape-h-bottom { bottom: 0; }
.tape-h-fire { background: var(--fire); }

.cw {
  position: relative;
  z-index: 30;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 88px 88px 80px 92px;
}

.slide-no {
  position: absolute;
  top: 64px; right: 72px;
  font-family: var(--fm);
  font-size: 18px;
  color: var(--steel);
  letter-spacing: 2px;
  z-index: 40;
}

.mono-tag {
  font-family: var(--fm);
  font-size: 18px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: var(--fire);
  margin-bottom: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.mono-tag::before { content: '//'; color: var(--steel); }
.mono-tag.gold { color: var(--gold); }
.mono-tag.gold::before { color: var(--steel); }

.h-line { width: 64px; height: 4px; margin-bottom: 40px; }
.h-line-fire { background: var(--fire); }
.h-line-gold { background: var(--gold); }

.disp-large {
  font-family: var(--fd);
  font-size: 108px;
  line-height: 0.92;
  letter-spacing: 2px;
  color: var(--bone);
  margin-bottom: 40px;
}
.disp-large em { color: var(--fire); font-style: normal; }
.disp-large .gold { color: var(--gold); }

.disp-medium {
  font-family: var(--fd);
  font-size: 88px;
  line-height: 0.93;
  letter-spacing: 2px;
  color: var(--bone);
  margin-bottom: 36px;
}
.disp-medium em { color: var(--fire); font-style: normal; }

.body-copy {
  font-family: var(--fb);
  font-size: 38px;
  font-weight: 300;
  color: var(--sub);
  line-height: 1.6;
  max-width: 880px;
}
.body-copy strong { color: var(--text); font-weight: 500; }
.body-copy em { color: var(--fire); font-style: normal; }

.author-badge { display: flex; align-items: center; gap: 24px; margin-top: 48px; padding: 20px 40px 20px 20px; background: rgba(26,26,26,0.85); border: 2px solid var(--steel); width: fit-content; }
.author-avatar { width: 88px; height: 88px; border-radius: 50%; border: 3px solid var(--fire); object-fit: cover; }
.author-name-text { font-family: var(--fd); font-size: 36px; color: var(--bone); letter-spacing: 1px; }
.author-role-text { font-family: var(--fm); font-size: 14px; color: var(--fire); letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }

.quote-mark {
  font-family: var(--fd);
  font-size: 160px;
  color: var(--fire);
  line-height: 0.7;
  opacity: 0.22;
  margin-left: -16px;
}

.quote-text {
  font-family: var(--fd);
  font-size: 80px;
  line-height: 0.96;
  letter-spacing: 1px;
  color: var(--bone);
}
.quote-text em { color: var(--fire); font-style: normal; }

@media print {
  @page { size: ${width}px ${height}px; margin: 0; }
  body { background: var(--void) !important; padding: 0 !important; display: block !important; }
  .slide { transform: none !important; margin: 0 !important; page-break-after: always; break-after: page; border: none !important; }
  .slide:last-of-type { page-break-after: auto; break-after: auto; }
}
</style>
</head>
<body>

<div class="preview-info">Carrossel Criador IA — ${name}</div>
${slidesHtml}
</body>
</html>`;

  fs.writeFileSync(targetPath, fullHtml, 'utf8');
  res.json({ ok: true, filename, fullPath: targetPath, relativePath: `Carrosseis/Instagram/${filename}` });
});

// ── Serve o Studio HTML na raiz ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'studio.html'));
});

// ── Serve arquivos estáticos (imagens, fontes, etc.) ──────────────────────
// index: false evita que index.html do site sobrescreva a rota /
app.use(express.static(BASE_DIR, { index: false }));

app.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║   🎨  Studio de Criativos — JG       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║   http://localhost:${PORT}               ║`);
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log('  Abrindo no browser...\n');
  // Tenta abrir automaticamente no browser padrão
  const { exec } = require('child_process');
  exec(`start http://localhost:${PORT}`);
});
