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
  { folder: path.join(BASE_DIR, 'Criativos', 'Logo', 'Assets'), platform: 'brand' },
  { folder: path.join(BASE_DIR, 'Criativos', 'Banners'),   platform: 'brand'     },
];

// NOTA: express.static registrado DEPOIS das rotas para não sobrescrever a raiz
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Funções de Apoio de Configuração ───────────────────────────────────────
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

const parseCookies = (cookieHeader) => {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURIComponent(parts.join('='));
  });
  return list;
};

// Middleware de Segurança Brutalista
const checkAuth = (req, res, next) => {
  const cfg = readConfig();
  const password = cfg.STUDIO_PASSWORD || 'gobira';

  // Exceções de rotas livres (login)
  if (req.path === '/api/login' || req.path === '/login.html') {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const session = cookies['studio_session'];

  if (session === password) {
    return next();
  }

  // Se for uma requisição de API
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Acesso negado: não autenticado.' });
  }

  // Caso contrário, redireciona para a tela de login
  res.redirect('/login.html');
};

app.use(checkAuth);

// ── Endpoint de Login ──────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const cfg = readConfig();
  const correctPassword = cfg.STUDIO_PASSWORD || 'gobira';
  if (password === correctPassword) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Senha incorreta' });
});

// ── Endpoint de Upload de Imagens ──────────────────────────────────────────
app.post('/api/upload-imagem', (req, res) => {
  const { name, base64 } = req.body;
  if (!name || !base64) {
    return res.status(400).json({ error: 'Dados insuficientes para upload.' });
  }
  try {
    const cleanBase64 = base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    
    const sanitizedName = name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const targetPath = path.join(BASE_DIR, 'Carrosseis', sanitizedName);
    
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Upload] Imagem salva na biblioteca: ${sanitizedName}`);
    res.json({ ok: true, filename: sanitizedName });
  } catch (err) {
    console.error('[Upload] Falha ao salvar imagem:', err.message);
    res.status(500).json({ error: 'Erro interno ao salvar arquivo.' });
  }
});


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

    // Se for LinkedIn, compila os slides em um arquivo PDF consolidado
    const isLinkedIn = file.toLowerCase().includes('linkedin');
    let pdfRelativePath = null;

    if (isLinkedIn) {
      send({ type: 'progress', message: 'Compilando slides em um único documento PDF para o LinkedIn...', total: allSlides.length, current: allSlides.length });
      try {
        const { PDFDocument } = require('pdf-lib');
        const pdfDoc = await PDFDocument.create();

        for (let i = 0; i < allSlides.length; i++) {
          const outputPath = path.join(outputDir, `slide_${String(i + 1).padStart(2, '0')}.png`);
          if (fs.existsSync(outputPath)) {
            const pngBytes = fs.readFileSync(outputPath);
            const pngImage = await pdfDoc.embedPng(pngBytes);
            const { width, height } = pngImage.scale(1);
            const page = pdfDoc.addPage([width, height]);
            page.drawImage(pngImage, { x: 0, y: 0, width: width, height: height });
          }
        }

        const pdfBytes = await pdfDoc.save();
        const pdfPath = path.join(dir, `${baseName}.pdf`);
        fs.writeFileSync(pdfPath, pdfBytes);
        pdfRelativePath = path.relative(BASE_DIR, pdfPath).replace(/\\/g, '/');
      } catch (pdfErr) {
        console.error('Erro ao gerar PDF:', pdfErr);
        send({ type: 'error', message: 'Erro ao compilar PDF: ' + pdfErr.message });
      }
    }

    send({
      type: 'done',
      total: allSlides.length,
      outputDir: path.relative(BASE_DIR, outputDir).replace(/\\/g, '/'),
      pdfPath: pdfRelativePath
    });
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

function getBibliotecaImagens() {
  try {
    const dir = path.join(BASE_DIR, 'Carrosseis');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
    });
  } catch (err) {
    console.error('[Biblioteca] Erro ao listar imagens:', err.message);
    return [];
  }
}

// ── API: buscar conteúdo de URL para gerar criativos ──────────────────────
app.post('/api/ia/fetch-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ ok: false, error: 'URL inválida. Use http:// ou https://' });
  }
  try {
    const https = require('https');
    const http = require('http');
    const protocol = url.startsWith('https') ? https : http;

    const rawHtml = await new Promise((resolve, reject) => {
      const req2 = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudioBot/1.0)' } }, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          resolve('REDIRECT:' + resp.headers.location);
          return;
        }
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
      });
      req2.on('error', reject);
      req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Timeout')); });
    });

    if (rawHtml.startsWith('REDIRECT:')) {
      return res.status(400).json({ ok: false, error: 'Redirecionamento não suportado. Acesse a URL final diretamente.' });
    }

    const clean = rawHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 10000);

    res.json({ ok: true, text: clean, length: clean.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Não foi possível acessar a URL: ' + e.message });
  }
});

// ── API: biblioteca de imagens ─────────────────────────────────────────────
app.get('/api/ia/biblioteca', (req, res) => {
  const imagens = getBibliotecaImagens();
  res.json({ ok: true, imagens });
});

// ── API: Galeria de Exemplos / Referências de Estilo ──────────────────────
const EXEMPLOS_DIR = path.join(BASE_DIR, 'Exemplos');

app.post('/api/exemplos/upload', (req, res) => {
  const { name, base64 } = req.body;
  if (!name || !base64) return res.status(400).json({ error: 'Dados insuficientes.' });
  try {
    fs.mkdirSync(EXEMPLOS_DIR, { recursive: true });
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const sanitized = `exemplo_${Date.now()}_${name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    fs.writeFileSync(path.join(EXEMPLOS_DIR, sanitized), buffer);
    res.json({ ok: true, filename: sanitized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/exemplos', (req, res) => {
  try {
    fs.mkdirSync(EXEMPLOS_DIR, { recursive: true });
    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const files = fs.readdirSync(EXEMPLOS_DIR)
      .filter(f => {
        const ext = path.extname(f).toLowerCase();
        return IMAGE_EXTS.includes(ext) || f.endsWith('.html');
      })
      .map(f => {
        const stat = fs.statSync(path.join(EXEMPLOS_DIR, f));
        const ext = path.extname(f).toLowerCase();
        return {
          filename: f,
          isImage: IMAGE_EXTS.includes(ext),
          size: stat.size,
          mtime: stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json({ ok: true, exemplos: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/exemplos/:filename', (req, res) => {
  try {
    const safe = path.basename(req.params.filename);
    const filePath = path.join(EXEMPLOS_DIR, safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUBLICAR: Fila ───────────────────────────────────────────────────────
app.post('/api/ia/chat', async (req, res) => {
  const { message, history, format = 'carousel', images = [], currentSlides = [], referenceImages = [] } = req.body;
  const cfg = readConfig();
  const apiKey = cfg.GEMINI_API_KEY;
 
  if (!apiKey) {
    return res.status(400).json({ error: 'GEMINI_API_KEY não configurada no studio.config' });
  }

  // 1. Imagens de referência de estilo (Galeria de Exemplos) — vêm primeiro com contexto
  const parts = [];
  if (referenceImages && referenceImages.length > 0) {
    parts.push({ text: `[REFERÊNCIAS DE ESTILO — ${referenceImages.length} exemplo(s) selecionado(s) pelo usuário]\nAnalise VISUALMENTE cada imagem de referência abaixo. Estude a paleta de cores, tipografia, layout, hierarquia visual, espaçamentos e composição. Use esses elementos como INSPIRAÇÃO de estilo nos slides que você vai criar ou modificar. NÃO copie o conteúdo textual — apenas o estilo visual.` });
    referenceImages.forEach(img => {
      const cleanData = img.data.replace(/^data:[^;]+;base64,/, '');
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/png', data: cleanData } });
    });
    parts.push({ text: '[FIM DAS REFERÊNCIAS DE ESTILO]' });
  }

  // 2. Processar e salvar imagens de dados recebidas via chat
  if (images && images.length > 0) {
    const carrosseisDir = path.join(BASE_DIR, 'Carrosseis');
    if (!fs.existsSync(carrosseisDir)) {
      fs.mkdirSync(carrosseisDir, { recursive: true });
    }

    if (images.length > 0) {
      parts.push({ text: `[IMAGENS DE DADOS — ${images.length} imagem(ns) para analisar e converter em componentes HTML nativos]` });
    }

    images.forEach(img => {
      try {
        const cleanBase64 = img.data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const timestamp = Date.now();
        const sanitizedName = `upload_${timestamp}_${img.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const targetPath = path.join(carrosseisDir, sanitizedName);
        fs.writeFileSync(targetPath, buffer);
        console.log(`[Chat IA] Imagem salva fisicamente na pasta Carrosseis/: ${sanitizedName}`);
        parts.push({ inlineData: { mimeType: img.mimeType, data: cleanBase64 } });
      } catch (err) {
        console.error('[Chat IA] Erro ao salvar imagem enviada pelo chat:', err.message);
      }
    });
  }

  // 3. Mensagem de texto do usuário
  if (message) {
    parts.push({ text: message });
  } else if (parts.length > 0) {
    parts.push({ text: 'Analise as referências/imagens e crie um carrossel brutalista de alta conversão.' });
  }

  // Carregar repositório de modelos (layouts) que o João gosta
  let listaModelos = [];
  try {
    const modelosPath = path.join(BASE_DIR, 'Modelos', 'modelos.json');
    if (fs.existsSync(modelosPath)) {
      listaModelos = JSON.parse(fs.readFileSync(modelosPath, 'utf8'));
    }
  } catch (e) {
    listaModelos = [
      { id: "split-screen", nome: "Divisão Brutalista (Split-Screen)", descricao: "Metade com foto nítida/desfocada na direita e metade com tipografia brutalista gigante na esquerda." },
      { id: "bento-metrics", nome: "Grade Bento (Cards de Destaque)", descricao: "Fundo creme/claro com cartões retangulares de borda preta grossa." },
      { id: "minimal-void", nome: "Vácuo Brutal (Foco em Texto)", descricao: "Fundo preto absoluto com tipografia gigantesca em vermelho brutalista ou branco." },
      { id: "editorial-focus", nome: "Foco Editorial (Estilo Revista)", descricao: "Foto nítida ocupando o topo do slide (50%) e a copy em letras brutas na base." },
      { id: "impact-quote", nome: "Citação Massiva (Destaque)", descricao: "Fundo creme ou vermelho com aspas gigantescas no fundo e texto preto absoluto." },
      { id: "giant-number", nome: "Número Gigante (Brutalista)", descricao: "Destaca um número ou estatística massiva com tipografia gigante agressiva." },
      { id: "social-proof", nome: "Post Social / Tweet", descricao: "Simula um post de rede social (Tweet) do João Gobira com foto de perfil e corpo em texto brutalista." },
      { id: "technical-sheet", nome: "Folha Editorial Técnica", descricao: "Fundo bege papel antigo, linhas finas duplas pretas, estilo conceitual editorial técnico chique." },
      { id: "neon-accent", nome: "Destaque Neon (Estilo Ric Neves)", descricao: "Fundo grafite profundo com rosa magenta neon fluorescente super marcante." }
    ];
  }

  const modelosStr = listaModelos.map(m => `- "${m.id}": ${m.nome} -> ${m.descricao}`).join('\n');

  // Biblioteca de imagens físicas (que já inclui a recém-salva!)
  const listaImagens = getBibliotecaImagens();
  const imagensStr = listaImagens.length > 0 
    ? `Lista de arquivos de imagens físicas disponíveis na sua pasta Carrosseis/:\n${listaImagens.map(i => `- "${i}"`).join('\n')}`
    : 'Nenhuma imagem física cadastrada. Use fundo sólido.';

  const isEditMode = currentSlides && currentSlides.length > 0;

  const refsContext = referenceImages && referenceImages.length > 0
    ? `\nREFERÊNCIAS DE ESTILO ATIVAS: ${referenceImages.length} exemplo(s) foram enviados antes da sua mensagem. Incorpore elementos visuais desses exemplos nos slides criados/modificados.\n`
    : '';

  const editModeContext = isEditMode ? `⚠️ MODO DE EDIÇÃO CIRÚRGICA ⚠️
O usuário já tem um carrossel com ${currentSlides.length} slides. Faça APENAS a alteração pedida — NÃO regenere o carrossel inteiro, a não ser que o usuário diga "refazer tudo" ou "criar novo carrossel do zero".

SLIDES ATUAIS (mantenha todos, exceto o que for pedido para alterar):
${currentSlides.map((s, i) => `  Slide ${i + 1} (índice ${i}): [${s.type}] TAG:"${(s.tag || '').slice(0, 35)}" | TÍTULO:"${(s.title || '').replace(/<[^>]+>/g, '').slice(0, 60)}"`).join('\n')}

COMO INTERPRETAR O PEDIDO:
- "adicionar depois do slide 3" → action:"insert_after", targetIndex:2 (índice 0-based do slide antes da inserção)
- "inserir depois do slide N" → action:"insert_after", targetIndex: N-1
- "colocar no final" → action:"insert_after", targetIndex:${currentSlides.length - 1}
- "substituir / trocar o slide N" → action:"replace", targetIndex: N-1
- "remover o slide N" → action:"delete", targetIndex: N-1
- "refazer tudo" / "criar novo carrossel" → action:"full" (retorna todos os slides)

ANÁLISE DE IMAGENS → COMPONENTES NATIVOS HTML (OBRIGATÓRIO):
Quando o usuário enviar uma imagem com dados (gráfico, tabela do Semrush, Google Trends, termos de busca, métricas):
1. ANALISE os dados visíveis: valores, percentuais, labels, tendências, palavras-chave
2. RECONSTRUA os dados como componente HTML brutalista nativo no campo "body" (custom-chart, vs-container ou step-list)
3. NUNCA use a imagem como "bg" (fundo). Sempre bg:"" para slides com dados. Layout recomendado: "technical-sheet" ou "neon-accent"
4. Se quiser exibir a imagem original dentro do slide SEM distorção como referência visual, use o campo "contentImage" com o nome do arquivo

FORMATO DE RESPOSTA PARA EDIÇÃO (JSON puro, sem markdown):
{
  "assistantMessage": "Mensagem breve explicando o que foi feito.",
  "action": "insert_after",
  "targetIndex": 2,
  "slides": [{ "type":"conteudo","layout":"technical-sheet","tag":"...","title":"...","body":"...","bg":"","contentImage":"" }]
}

---
DIRETRIZES GERAIS (aplique nos slides novos/modificados):
${refsContext}` : '';

  const systemInstruction = editModeContext + `Você é o co-criador oficial de criativos de João Gobira, especialista em Growth, Gestão e Marketing de Performance.
Seu objetivo é gerar a copy e estrutura de slides de um criativo brutalista de alta conversão.

FORMATO DO CRIATIVO SOLICITADO: "${format}"
Considere as diretrizes do formato solicitado para compor títulos e copys:
- "carousel" ou "linkedin-carousel": Carrossel (1080x1350px). Média de 5 a 10 slides. Texto fluido, bem sequenciado.
- "square": Meta Ads Estático 1:1 (1080x1080px). Anúncio único de alto impacto. Copy extremamente direta, headline curtíssima, CTA visível. Pensado para feed pago do Instagram/Facebook.
- "meta-portrait": Meta Ads Feed 4:5 (1080x1350px). Anúncio único vertical. Mais espaço que o quadrado — use para copy um pouco mais desenvolvida com imagem de fundo impactante e CTA forte. Ideal para tráfego pago.
- "vertical": Meta Ads Stories / Reels (1080x1920px). Proporção 9:16. Máximo 1 slide ultra impactante para story patrocinado, ou sequência de 3 slides rápidos. Copy curtíssima, visual cinematográfico.
- "horizontal" ou "banner-horizontal" ou "youtube-thumb": Proporção horizontal/paisagem. Títulos bem amplos em uma linha e parágrafos distribuídos horizontalmente.

DIRETRIZES DE MARCA (João Gobira):
- Tom de Voz: Direto, firme, com peso emocional e autoridade. Tom nascido da trincheira, do campo de batalha real de growth, e não de teorias corporativas vazias.
- Use metáforas ocasionais de Jiu-Jitsu, tatame, resiliência sob pressão e sobrevivência.
- NUNCA use clichês corporativos como: "disruptivo", "innovador", "inovador", "potencializar resultados", "jornada de aprendizado", "entrega de valor", "ecossistema".
- Use números e dados específicos (ex: "47% de aumento em vendas" ao invés de "resultado expressivo").
- Fale para fundadores e gestores que precisam de método e dados.

REPOSITÓRIO DE MODELOS VISUAIS (LAYOUTS) DO JOÃO:
Escolha com extrema sabedoria e de forma variada o layout de cada slide (atribuindo a chave "layout") para evitar posts monótonos ou repetitivos. Tente variar os layouts durante a narrativa do carrossel/criativo!
Aqui estão os modelos visuais e layouts cadastrados e aprovados pelo João Gobira:
${modelosStr}

REGRAS DE IMAGENS & FOTOGRAFIAS:
${imagensStr}

A sua escolha de imagem para o campo "bg" deve ser altamente estratégica e lógica com base no teor do slide:
- Use preferencialmente "joao-gobira.JPG" para Capa e CTA.
- Use "IMG_7386.JPG" (tatame/luta) se o slide falar sobre disciplina, Jiu-Jitsu, resiliência, luta diária ou sob pressão.
- Use "IMG_7392.JPG" (palco/palestra) se o slide falar sobre autoridade, ensinar equipes, palestras, mentorias, liderança e escala.
- Use "IMG_7397.JPG" (executivo/negócios) se o slide falar sobre reuniões, fechamentos de contrato, finanças corporativas e o lado corporativo de growth.
- Use "DSC08278.png" (action/trabalho) se o slide falar sobre execução operacional, "colocar a mão na massa", tráfego, código ou análises em tempo real.
- Se o usuário carregou novas fotos suas boas de tatame, palestra ou trabalho, elas aparecerão com o prefixo "upload_timestamp_nome.png" na lista acima. Sinta-se 100% livre para usá-las estrategicamente no campo "bg" nos slides ideais!
- Se o slide requerer foco puramente textual ou tiver um gráfico/tabela HTML nativo, deixe o campo "bg" vazio "" para fundo sólido.

REGRA DE CRIAÇÃO DE GRÁFICOS E COMPONENTES DE DADOS NATIVOS (HTML):
Se você receber imagens contendo dados, prints de gráficos, roadmaps ou dados textuais desorganizados (ou se o usuário fornecer dados de growth/vendas no texto e pedir um design premium), você DEVE converter e traduzir esses dados automaticamente em componentes de código HTML brutalistas nativos dentro do campo "body" do slide correspondente.
As três estruturas aprovadas para você injetar no campo "body" são:

1. GRÁFICO DE BARRAS BRUTALISTA HORIZONTAL (usar "custom-chart"):
Use para comparar métricas ou estatísticas. Defina a largura da barra no style inline "width: X%".
Estrutura exata:
<div class="custom-chart">
  <div class="chart-header">
    <div class="chart-title">NOME DO GRÁFICO</div>
    <div class="chart-legend">
      <div class="legend-item"><div class="legend-color off"></div><span>Meta Ads</span></div>
      <div class="legend-item"><div class="legend-color on"></div><span>LinkedIn</span></div>
    </div>
  </div>
  <div class="chart-row">
    <div class="chart-label">Conversão</div>
    <div class="chart-bars">
      <div class="bar off" style="width: 35%;"></div>
      <div class="bar on" style="width: 82%;"></div>
    </div>
  </div>
</div>

2. COMPARAÇÃO ANTES VS DEPOIS (usar "vs-container"):
Use para contrastar o estado caótico e a solução estruturada de growth.
Estrutura exata:
<div class="vs-container">
  <div class="vs-col">
    <div class="vs-title">Antes (Sem Método)</div>
    <div class="vs-item">Lutas diárias sem ROI previsível</div>
    <div class="vs-item">Lead frio sem qualificação</div>
  </div>
  <div class="vs-col winner">
    <div class="vs-title">Depois (Com Growth)</div>
    <div class="vs-item">ROI escalável em 30 dias</div>
    <div class="vs-item">Lead quente e qualificado no CRM</div>
  </div>
</div>

3. ROADMAP / LISTA DE PASSOS (usar "step-list"):
Use para ilustrar planos de ação, cronogramas ou sequências práticas.
Estrutura exata:
<div class="step-list">
  <div class="step-item">
    <div class="step-num">01</div>
    <div class="step-text"><strong>Análise:</strong> Mapeamos o gargalo real de conversão do funil.</div>
  </div>
  <div class="step-item">
    <div class="step-num">02</div>
    <div class="step-text"><strong>Aceleração:</strong> Injetamos tráfego altamente qualificado.</div>
  </div>
</div>

Importante: Ao usar esses componentes nativos, o campo "body" deve conter APENAS o bloco HTML do componente escolhido, e o "layout" do slide correspondente deve ser preferencialmente "minimal-void", "bento-metrics", "technical-sheet" ou "neon-accent" para máximo contraste estético, mantendo o "bg" vazio "".

REGRAS DE ESTRUTURA DOS SLIDES:
1. Capa (Slide 1): Título impactante (Bebas Neue, use <em> para destacar em vermelho/fluorescente, ex: "3 LIÇÕES DO<br><em>JIU-JITSU</em>") + Subtítulo curto de apoio. A tag deve ser o tema central (ex: "GROWTH NÚMEROS"). Use "split-screen" ou "editorial-focus".
2. Slides Internos: Varie os layouts a cada slide para manter a leitura viva. Use os novos layouts "neon-accent" e "technical-sheet" alternados com os tradicionais.
3. Slide de Métrica/Destaque: Ótimo usar layout "giant-number" (ex: número "48%" ou "3.4M" no título e texto curto no corpo).
4. Slide de Depoimento/Tweet: Use layout "social-proof" se quiser simular um tweet/depoimento direto seu sobre o tema do carrossel.
5. Slide CTA Final: Ação clara e firme. Use "split-screen", "impact-quote" ou "neon-accent" com sua foto no bg.

FORMATO DE RESPOSTA (OBRIGATÓRIO):
Responda UNICAMENTE com um objeto JSON puro, sem blocos de código markdown ou explicações fora do JSON.
{
  "assistantMessage": "Mensagem inspiradora estilo João Gobira sobre a estratégia brutalista do criativo.",
  "slides": [
    {
      "type": "capa",
      "layout": "split-screen",
      "tag": "CATEGORIA DO CONTEÚDO",
      "title": "TÍTULO DA CAPA<br>COM <em>DESTAQUE</em>",
      "body": "Subtítulo de apoio complementar.",
      "bg": "joao-gobira.JPG"
    },
    {
      "type": "conteudo",
      "layout": "neon-accent",
      "tag": "MÉTRICA REAL",
      "title": "GRAFICO DE DADOS",
      "body": "<div class=\"custom-chart\">...</div>",
      "bg": ""
    },
    {
      "type": "cta",
      "layout": "split-screen",
      "tag": "JOGO DA EXECUÇÃO",
      "title": "TORNE-SE UM<br><em>BUILDER.</em>",
      "body": "Toque no link da minha bio e me envie uma mensagem agora.",
      "bg": "joao-gobira.JPG"
    }
  ]
}`;

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
    parts: parts
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

  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
    'gemini-flash-latest',
    'gemini-pro-latest'
  ];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[Gemini] Tentando modelo ${model} via API v1...`);
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
      const response = await axios.post(url, payload, { timeout: 30000 });
      const text = response.data.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(text.trim());
      console.log(`[Gemini] Sucesso com ${model} via API v1!`);
      return res.json({ ok: true, model, ...parsed });
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini] Sem resposta para ${model} no v1. Tentando v1beta...`);
      
      try {
        const urlBeta = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await axios.post(urlBeta, payload, { timeout: 30000 });
        const text = response.data.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(text.trim());
        console.log(`[Gemini] Sucesso com ${model} via API v1beta!`);
        return res.json({ ok: true, model, ...parsed });
      } catch (errBeta) {
        lastError = errBeta;
        console.error(`[Gemini] Falha definitiva no modelo ${model}:`, errBeta.response?.data?.error?.message || errBeta.message);
      }
    }
  }
  res.status(500).json({ error: `Falha ao conectar com o Gemini: ${lastError?.response?.data?.error?.message || lastError?.message}` });
});

app.post('/api/ia/salvar-criativo', (req, res) => {
  const { name, slides, format = 'carousel' } = req.body;
  if (!name || !slides || slides.length === 0) {
    return res.status(400).json({ error: 'Dados insuficientes' });
  }

  let folder = 'Carrosseis/Instagram';
  let slideClass = 'slide';
  let width = 1080;
  let height = 1350;
  let scale = 0.38;

  if (format === 'linkedin-carousel') {
    folder = 'Carrosseis/LinkedIn';
    slideClass = 'slide';
  } else if (format === 'youtube-thumb') {
    folder = 'Criativos/YouTube';
    slideClass = 'yt-thumb';
    width = 1280;
    height = 720;
    scale = 0.3;
  } else if (format === 'brand-logo') {
    folder = 'Criativos/Logo';
    slideClass = 'logo-asset';
    width = 800;
    height = 800;
    scale = 0.5;
  } else if (format === 'banner-horizontal') {
    folder = 'Criativos/Banners';
    slideClass = 'banner';
    width = 1920;
    height = 1080;
    scale = 0.25;
  } else if (format === 'square') {
    folder = 'Criativos/MetaAds';
    width = 1080;
    height = 1080;
    slideClass = 'ad-square';
  } else if (format === 'meta-portrait') {
    folder = 'Criativos/MetaAds';
    width = 1080;
    height = 1350;
    slideClass = 'ad-portrait';
  } else if (format === 'vertical') {
    folder = 'Criativos/MetaAds';
    width = 1080;
    height = 1920;
    slideClass = 'ad-story';
  } else if (format === 'horizontal') {
    folder = 'Criativos/Banners';
    width = 1920;
    height = 1080;
    scale = 0.25;
    slideClass = 'banner';
  }

  const marginBottom = Math.round(-height * (1 - scale)) + 12;

  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `criativo_ia_${sanitized}_${Date.now()}.html`;
  const targetPath = path.join(BASE_DIR, folder, filename);

  // Garante que a pasta destino exista
  fs.mkdirSync(path.join(BASE_DIR, folder), { recursive: true });


  let slidesHtml = '';
  slides.forEach((s, idx) => {
    const slideNo = `${String(idx + 1).padStart(2, '0')}/${String(slides.length).padStart(2, '0')}`;
    const bgUrl = s.bg ? `../${s.bg}` : '';
    const layoutClass = `layout-${s.layout || 'split-screen'}`;
    const accentMap = { fire: '#C8391A', gold: '#B8922A', neon: '#E1306C', bone: '#F0EBE0' };
    const accentVar = accentMap[s.accentColor] ? `--fire:${accentMap[s.accentColor]};` : '';
    
    let isSocialProof = s.layout === 'social-proof';
    let isGiantNumber = s.layout === 'giant-number';
    let isCapa = s.type === 'capa';
    let isCta = s.type === 'cta';
    let isQuote = s.type === 'quote';

    slidesHtml += `\n<!-- SLIDE ${idx + 1}: ${s.type.toUpperCase()} -->\n`;
    
    if (isSocialProof) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}" style="background: var(--carbon);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="justify-content: center; align-items: center; padding-top: 100px;">
    <div class="mono-tag" style="margin-bottom: 24px;">${s.tag || 'PROVA SOCIAL'}</div>
    <div class="tweet-card">
      <div class="tweet-header">
        <img class="tweet-avatar" src="../Carrosseis/joao-gobira.JPG" onerror="this.src='../joao-gobira.JPG'">
        <div class="tweet-user-info">
          <div class="tweet-name">João Gobira <span class="tweet-verified">✓</span></div>
          <div class="tweet-handle">@joaogobira</div>
        </div>
      </div>
      <div class="tweet-body">
        ${s.body || s.title}
      </div>
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isGiantNumber) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="justify-content: center; gap: 0;">
    <div class="mono-tag" style="margin-bottom: 24px;">${s.tag || 'GROWTH MÉTRICAS'}</div>
    <div class="disp-large" style="font-size: 220px; line-height: 0.75; color: var(--fire); margin-bottom: 24px; font-weight: 900;">
      ${s.title}
    </div>
    <div class="body-copy" style="font-size: 40px; border-top: 3px solid var(--steel); padding-top: 24px; color: var(--sub);">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isCapa) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>

  ${bgUrl ? `<div class="split-bg" style="background-image: url('${bgUrl}'); filter: grayscale(30%) contrast(1.1) brightness(0.9);"></div><div class="split-gradient"></div><div class="split-gradient-bottom"></div>` : ''}

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
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}" style="background: var(--void);">
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
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}" style="background: var(--carbon);">
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
      const contentImgUrl = s.contentImage ? `../${s.contentImage}` : '';

      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}" style="${accentVar}background: ${bgUrl ? 'transparent' : 'var(--void)'};">
  <div class="grain"></div>
  <div class="tape-v ${tapeClass}"></div>
  <div class="slide-no">${slideNo}</div>

  ${bgUrl ? `<div class="photo-bg" style="background-image: url('${bgUrl}'); filter: grayscale(40%) contrast(1.1) brightness(0.45);"></div><div class="photo-overlay-mid"></div>` : ''}

  <div class="cw" style="justify-content: center; gap: 0;">
    <div class="${tagClass}" style="margin-bottom: 32px;">${s.tag || s.type.toUpperCase()}</div>
    <div class="h-line ${lineClass}"></div>

    <div class="disp-medium" style="margin-bottom: ${contentImgUrl ? '24px' : '48px'};">
      ${s.title}
    </div>

    ${contentImgUrl ? `<img src="${contentImgUrl}" style="max-width:100%; max-height:320px; object-fit:contain; margin: 0 auto 28px; display:block; border: 1px solid rgba(255,255,255,0.08);">` : ''}

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
  font-size: 26px;
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

/* ==========================================================================
   VARIAÇÕES DE LAYOUTS BRUTALISTAS JG (modelos.json)
   ========================================================================== */

/* 2. Grade Bento (layout-bento-metrics) */
.slide.layout-bento-metrics {
  background: var(--bone) !important;
  color: var(--void) !important;
}
.slide.layout-bento-metrics .tape-v {
  background: var(--void) !important;
  width: 8px !important;
}
.slide.layout-bento-metrics .mono-tag {
  background: var(--void) !important;
  color: var(--bone) !important;
  border: 2px solid var(--void) !important;
}
.slide.layout-bento-metrics .h-line {
  background: var(--void) !important;
}
.slide.layout-bento-metrics .disp-medium,
.slide.layout-bento-metrics .disp-large {
  color: var(--void) !important;
}
.slide.layout-bento-metrics .body-copy {
  color: var(--void) !important;
  border-top: 3px solid var(--void) !important;
  background: rgba(0, 0, 0, 0.04) !important;
  border: 3px solid var(--void) !important;
  padding: 30px !important;
  font-weight: 500 !important;
  box-shadow: 8px 8px 0px var(--void) !important;
  transform: rotate(-0.5deg) !important;
}

/* 3. Vácuo Brutal (layout-minimal-void) */
.slide.layout-minimal-void {
  background: var(--void) !important;
  color: var(--text) !important;
}
.slide.layout-minimal-void .tape-v {
  background: var(--fire) !important;
  width: 15px !important;
}
.slide.layout-minimal-void .cw {
  padding-left: 100px !important;
  padding-right: 100px !important;
  width: 100% !important;
}
.slide.layout-minimal-void .disp-medium,
.slide.layout-minimal-void .disp-large {
  font-size: 110px !important;
  line-height: 0.9 !important;
  color: var(--text) !important;
}
.slide.layout-minimal-void .body-copy {
  font-size: 44px !important;
  border-top: 4px solid var(--fire) !important;
  color: var(--sub) !important;
  font-weight: 300 !important;
}

/* 4. Foco Editorial (layout-editorial-focus) */
.slide.layout-editorial-focus {
  background: var(--carbon) !important;
}
.slide.layout-editorial-focus .split-bg,
.slide.layout-editorial-focus .photo-bg {
  top: 0 !important; left: 0 !important; right: 0 !important; bottom: auto !important;
  width: 100% !important; height: 50% !important;
  border-bottom: 4px solid var(--fire) !important;
  border-left: none !important;
}
.slide.layout-editorial-focus .split-gradient,
.slide.layout-editorial-focus .split-gradient-bottom,
.slide.layout-editorial-focus .photo-overlay {
  display: none !important;
}
.slide.layout-editorial-focus .cw {
  height: 50% !important;
  top: 50% !important;
  width: 100% !important;
  padding: 60px 80px !important;
  justify-content: center !important;
}

/* 5. Citação Massiva (layout-impact-quote) */
.slide.layout-impact-quote {
  background: var(--fire) !important;
  color: var(--void) !important;
}
.slide.layout-impact-quote .tape-v {
  background: var(--void) !important;
  width: 8px !important;
}
.slide.layout-impact-quote .mono-tag {
  background: var(--void) !important;
  color: var(--fire) !important;
}
.slide.layout-impact-quote .h-line {
  background: var(--void) !important;
}
.slide.layout-impact-quote .quote-mark {
  color: var(--void) !important;
  opacity: 0.15 !important;
  font-size: 280px !important;
}
.slide.layout-impact-quote .quote-text {
  color: var(--void) !important;
  font-size: 84px !important;
}
.slide.layout-impact-quote .body-copy {
  color: var(--void) !important;
  border-top: 3px solid var(--void) !important;
  font-weight: 500 !important;
}

/* 6. Número Gigante (layout-giant-number) */
.slide.layout-giant-number {
  background: var(--void) !important;
}
.slide.layout-giant-number .tape-v {
  background: var(--fire) !important;
  width: 20px !important;
}
.slide.layout-giant-number .disp-large {
  font-size: 220px !important;
  line-height: 0.75 !important;
  color: var(--fire) !important;
  margin-bottom: 24px !important;
  font-weight: 900 !important;
}
.slide.layout-giant-number .disp-large em {
  color: var(--bone) !important;
  font-style: normal !important;
}
.slide.layout-giant-number .body-copy {
  font-size: 40px !important;
  border-top: 3px solid var(--steel) !important;
  padding-top: 24px !important;
  color: var(--sub) !important;
}

/* 7. Post Social / Tweet (layout-social-proof) */
.slide.layout-social-proof {
  background: var(--carbon) !important;
}
.slide.layout-social-proof .tweet-card {
  background: var(--void) !important;
  border: 3px solid var(--steel) !important;
  padding: 40px !important;
  box-shadow: 12px 12px 0px rgba(0, 0, 0, 0.4) !important;
  margin-top: 40px !important;
  width: 100% !important;
}
.slide.layout-social-proof .tweet-header {
  display: flex !important;
  align-items: center !important;
  gap: 20px !important;
  margin-bottom: 30px !important;
}
.slide.layout-social-proof .tweet-avatar {
  width: 80px !important;
  height: 80px !important;
  border-radius: 50% !important;
  border: 2px solid var(--fire) !important;
}
.slide.layout-social-proof .tweet-user-info {
  display: flex !important;
  flex-direction: column !important;
}
.slide.layout-social-proof .tweet-name {
  font-family: var(--fc) !important;
  font-size: 28px !important;
  font-weight: 800 !important;
  color: var(--bone) !important;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}
.slide.layout-social-proof .tweet-verified {
  color: #1DA1F2 !important;
  font-size: 20px !important;
}
.slide.layout-social-proof .tweet-handle {
  font-family: var(--fm) !important;
  font-size: 16px !important;
  color: var(--muted) !important;
}
.slide.layout-social-proof .tweet-body {
  font-family: var(--fb) !important;
  font-size: 34px !important;
  line-height: 1.5 !important;
  color: var(--text) !important;
}
.slide.layout-social-proof .tweet-body strong {
  color: var(--fire) !important;
}

/* 8. Folha Editorial Técnica (layout-technical-sheet) */
.slide.layout-technical-sheet {
  background: #F4F0E6 !important;
  color: #111111 !important;
}
.slide.layout-technical-sheet .tape-v {
  background: #111111 !important;
  width: 6px !important;
}
.slide.layout-technical-sheet .mono-tag {
  color: #111111 !important;
  font-weight: 700 !important;
}
.slide.layout-technical-sheet .mono-tag::before {
  color: var(--fire) !important;
}
.slide.layout-technical-sheet .h-line {
  background: #111111 !important;
  height: 2px !important;
  width: 100% !important;
  margin-bottom: 30px !important;
}
.slide.layout-technical-sheet .h-line::after {
  content: '' !important;
  display: block !important;
  height: 2px !important;
  background: #111111 !important;
  margin-top: 4px !important;
}
.slide.layout-technical-sheet .disp-medium,
.slide.layout-technical-sheet .disp-large {
  color: #111111 !important;
  font-family: var(--fm) !important;
  font-size: 72px !important;
  font-weight: 700 !important;
  letter-spacing: -1px !important;
  line-height: 1.0 !important;
}
.slide.layout-technical-sheet .disp-medium em,
.slide.layout-technical-sheet .disp-large em {
  color: var(--fire) !important;
  font-style: normal !important;
}
.slide.layout-technical-sheet .body-copy {
  color: #333333 !important;
  font-family: var(--fm) !important;
  font-size: 28px !important;
  line-height: 1.5 !important;
  border-top: 1px solid #111111 !important;
  padding-top: 30px !important;
}

/* 9. Destaque Neon (layout-neon-accent) */
.slide.layout-neon-accent {
  background: #121212 !important;
  background-image: radial-gradient(rgba(225, 48, 108, 0.08) 1px, transparent 0) !important;
  background-size: 24px 24px !important;
}
.slide.layout-neon-accent .tape-v {
  background: #E1306C !important;
  box-shadow: 0 0 10px #E1306C !important;
  width: 6px !important;
}
.slide.layout-neon-accent .mono-tag {
  color: #E1306C !important;
  text-shadow: 0 0 5px rgba(225, 48, 108, 0.3) !important;
}
.slide.layout-neon-accent .h-line {
  background: #E1306C !important;
  box-shadow: 0 0 8px #E1306C !important;
}
.slide.layout-neon-accent .disp-medium,
.slide.layout-neon-accent .disp-large {
  color: var(--bone) !important;
}
.slide.layout-neon-accent .disp-medium em,
.slide.layout-neon-accent .disp-large em {
  color: #E1306C !important;
  text-shadow: 0 0 10px rgba(225, 48, 108, 0.6) !important;
  font-style: normal !important;
}
.slide.layout-neon-accent .body-copy {
  color: var(--sub) !important;
  border-top: 2px solid rgba(225, 48, 108, 0.2) !important;
}
.slide.layout-neon-accent .body-copy strong {
  color: #E1306C !important;
}

/* Componentes de Dados Brutalistas Dinâmicos */
.custom-chart {
  background: var(--carbon);
  padding: 32px;
  border: 1px solid var(--iron);
  width: 100%;
  margin-top: 30px;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid var(--steel);
  padding-bottom: 16px;
  margin-bottom: 24px;
}
.chart-title {
  font-family: var(--fc);
  color: var(--bone);
  font-size: 24px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.chart-legend {
  display: flex;
  justify-content: flex-end;
  gap: 24px;
  font-family: var(--fm);
  font-size: 14px;
  color: var(--sub);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.legend-color {
  width: 12px;
  height: 12px;
}
.legend-color.off {
  background: var(--steel);
}
.legend-color.on {
  background: var(--fire);
}
.slide.layout-neon-accent .legend-color.on {
  background: #E1306C;
  box-shadow: 0 0 5px #E1306C;
}
.chart-row {
  display: flex;
  align-items: center;
  margin-bottom: 24px;
}
.chart-row:last-child {
  margin-bottom: 0;
}
.chart-label {
  width: 180px;
  font-family: var(--fb);
  font-weight: 500;
  font-size: 22px;
  color: var(--text);
  text-align: right;
  padding-right: 24px;
}
.chart-bars {
  flex: 1;
  border-left: 2px dashed var(--steel);
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar {
  height: 32px;
}
.bar.off {
  background: var(--steel);
}
.bar.on {
  background: var(--fire);
}
.slide.layout-neon-accent .bar.on {
  background: #E1306C;
  box-shadow: 0 0 5px #E1306C;
}

/* Layout VS e Antes/Depois */
.vs-container {
  display: flex;
  gap: 32px;
  width: 100%;
  margin-top: 30px;
}
.vs-col {
  flex: 1;
  background: var(--carbon);
  border: 1px solid var(--iron);
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.vs-col.winner {
  border-color: var(--fire);
  background: rgba(200, 57, 26, 0.03);
}
.slide.layout-neon-accent .vs-col.winner {
  border-color: #E1306C;
  background: rgba(225, 48, 108, 0.03);
}
.vs-title {
  font-family: var(--fc);
  font-size: 26px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--bone);
  border-bottom: 2px solid var(--steel);
  padding-bottom: 12px;
  margin-bottom: 8px;
}
.vs-col.winner .vs-title {
  color: var(--fire);
}
.slide.layout-neon-accent .vs-col.winner .vs-title {
  color: #E1306C;
}
.vs-item {
  font-family: var(--fb);
  font-size: 22px;
  color: var(--sub);
  line-height: 1.4;
  padding-left: 20px;
  position: relative;
}
.vs-item::before {
  content: '▪';
  position: absolute;
  left: 0;
  color: var(--muted);
}
.vs-col.winner .vs-item::before {
  color: var(--fire);
}
.slide.layout-neon-accent .vs-col.winner .vs-item::before {
  color: #E1306C;
}

/* Layout Steps / Passos */
.step-list {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}
.step-item {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  background: var(--carbon);
  padding: 24px;
  border: 1px solid var(--iron);
  border-left: 4px solid var(--fire);
}
.slide.layout-neon-accent .step-item {
  border-left-color: #E1306C;
}
.step-num {
  font-family: var(--fd);
  font-size: 48px;
  color: var(--fire);
  line-height: 0.8;
}
.slide.layout-neon-accent .step-num {
  color: #E1306C;
}
.step-text {
  font-family: var(--fb);
  font-size: 24px;
  font-weight: 300;
  line-height: 1.4;
  color: var(--text);
}

/* Layout Métrica / Data */
.layout-data .data-number {
  font-family: var(--fd);
  font-size: 160px;
  color: var(--fire);
  line-height: 0.8;
  font-weight: 900;
  margin-top: 30px;
  letter-spacing: -2px;
}
.slide.layout-neon-accent.layout-data .data-number {
  color: #E1306C;
  text-shadow: 0 0 10px rgba(225, 48, 108, 0.4);
}
.layout-data .data-label {
  font-family: var(--fm);
  font-size: 18px;
  letter-spacing: 3px;
  color: var(--muted);
  text-transform: uppercase;
  margin-top: 12px;
}



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
  res.json({ ok: true, filename, fullPath: targetPath, relativePath: `${folder}/${filename}` });
});

// ── Serve o Studio HTML na raiz ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
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
