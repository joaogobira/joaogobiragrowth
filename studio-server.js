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

  // Exceções de rotas livres (login, blog, newsletter)
  if (req.path === '/api/login' || req.path === '/login.html' || req.path === '/api/newsletter') {
    return next();
  }

  if (req.path.startsWith('/blog/') || req.path.startsWith('/posts/') || req.path === '/sitemap.xml' || req.path === '/robots.txt' || req.path === '/404.html') {
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
  const { message, history, format = 'carousel', images = [], currentSlides = [], referenceImages = [], brandId = 'jg' } = req.body;
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

  // Carregar repositório de modelos (layouts) por marca
  let listaModelos = [];
  try {
    const brandModelosPath = path.join(BASE_DIR, 'Modelos', `modelos_${brandId}.json`);
    const defaultModelosPath = path.join(BASE_DIR, 'Modelos', 'modelos.json');
    const modelosPath = fs.existsSync(brandModelosPath) ? brandModelosPath : defaultModelosPath;

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
O usuário já tem um carrossel com ${currentSlides.length} slides. Faça APENAS a alteração pedida — NÃO regenere nada além do necessário.

SLIDES ATUAIS — DADOS COMPLETOS (use como base para qualquer edição):
${currentSlides.map((s, i) => JSON.stringify({ idx: i, type: s.type, layout: s.layout || '', tag: s.tag || '', title: (s.title || '').replace(/<[^>]+>/g, '').slice(0, 80), bg: s.bg || '', body_preview: (s.body || '').replace(/<[^>]+>/g, '').slice(0, 60) })).join('\n')}

COMO INTERPRETAR O PEDIDO (escolha a ação mais cirúrgica):

action:"patch" — USE QUANDO o pedido altera apenas 1 ou 2 campos de 1 slide (ex: "coloca minha foto", "muda o título do slide 2", "troca o bg", "altera o tag").
  → Retorne SOMENTE os campos que mudam. NÃO inclua "slides". Formato:
  { "assistantMessage":"...", "action":"patch", "targetIndex": N, "patch": {"campo":"valor"} }
  Exemplos de pedidos → patch:
  - "coloca minha foto no slide 1" → patch: {"bg":"joao-gobira.JPG"}
  - "muda o título da capa" → patch: {"title":"NOVO TÍTULO"}
  - "altera o layout do slide 3 para bento-grid" → patch: {"layout":"bento-grid"}
  - "muda a tag do slide 2" → patch: {"tag":"NOVA TAG"}

action:"replace" — USE QUANDO o pedido reescreve o conteúdo inteiro de 1 slide (ex: "refaz o slide 3", "cria um slide novo sobre X no lugar do slide 2").
  → Retorne 1 slide completo em "slides". targetIndex obrigatório.

action:"insert_after" — USE para inserir slide novo depois de uma posição.
  → targetIndex = índice do slide ANTES da inserção (0-based).

action:"delete" — USE para remover um slide.

action:"full" — USE APENAS se o usuário pedir "refazer tudo" ou "criar do zero". NUNCA use full para pedidos que mencionam um slide específico ou um elemento específico.

ANÁLISE DE IMAGENS → COMPONENTES NATIVOS HTML (OBRIGATÓRIO):
Quando o usuário enviar uma imagem com dados (gráfico, tabela do Semrush, Google Trends, termos de busca, métricas):
1. ANALISE os dados visíveis: valores, percentuais, labels, tendências, palavras-chave
2. RECONSTRUA os dados como componente HTML brutalista nativo no campo "body" (custom-chart, vs-container ou step-list)
3. NUNCA use a imagem como "bg" (fundo). Sempre bg:"" para slides com dados. Layout recomendado: "technical-sheet" ou "neon-accent"
4. Se quiser exibir a imagem original dentro do slide SEM distorção como referência visual, use o campo "contentImage" (passando a url da imagem/base64 original).` : '';

  const structureRules = brandId === 'tgsr' ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE ESTRUTURA — TAGSERVER (SIGA À RISCA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYOUTS DISPONÍVEIS (use APENAS estes 8 + os específicos de formato):
Carrossel: "capa", "minimal-void", "bento-grid", "numbered-list", "dark-quote-pull", "midnight-tabela-compara-o", "testimonial-stack", "social-proof-cta-direto"
YouTube: "clean-youtube-thumb" | Story/Vertical: "story-a-capa-glow" | Meta Ads: "bento-modern-ad" | Banner: "banner-a-dark-split-cta"

REGRA #1 — VARIEDADE OBRIGATÓRIA:
Nunca repita o mesmo layout em slides consecutivos.
"minimal-void" pode aparecer até 2x. Todos os outros: máximo 1x por carrossel.

REGRA #2 — ARQUITETURA DE CARROSSEL:
Posição 1 → CAPA: layout:"capa", params:{variant:"split-left", badge:"bl"}, bg:foto conceitual de tecnologia/dados
Posição 2 → PROBLEMA/DOR: "minimal-void" ou "dark-quote-pull" — frase brutal, bg:""
Posição 3 → DADO/PROVA: "bento-grid" — múltiplas métricas de resultado, bg:""
Posição 4 → MÉTODO: "numbered-list" — passos numerados, bg:""
Posição 5 → COMPARAÇÃO: "midnight-tabela-compara-o" — antes/depois, com/sem, bg:""
Posição 6 → PROVA SOCIAL: "testimonial-stack" — depoimento real de cliente, bg:""
Posição 7+ → CTA FINAL: "social-proof-cta-direto" — resultados + link, bg:""

REGRA #3 — MAPEAMENTO CONTEÚDO → LAYOUT:
- Múltiplas métricas/números (2–4 resultados)? → "bento-grid" (HTML bento-2x2 no body)
- Lista de passos, framework, sequência? → "numbered-list" (HTML num-list no body)
- Comparação dois cenários? → "midnight-tabela-compara-o" (HTML comp-table no body)
- Citação, insight, frase de impacto? → "dark-quote-pull"
- Depoimento de cliente? → "testimonial-stack" (HTML testimonial-card no body)
- Slide de fechamento/CTA? → "social-proof-cta-direto" (HTML sp-row no body)
- Impacto textual puro, dado chocante? → "minimal-void"

REGRA #4 — CAPA PARAMÉTRICA (layout:"capa"):
Sempre envie params com variant e badge. Exemplos:
- params:{variant:"split-left", badge:"bl"} — padrão TagServer
- params:{variant:"blur-hero", badge:"br"} — fullscreen foto
- params:{variant:"top-photo", badge:"bl"} — foto no topo

REGRA #5 — FUNDO (bg):
- Capa: foto conceitual de tecnologia/dados se disponível, senão bg:""
- Todos os outros slides: bg:"" (foto distrai do dado)`

  : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE ESTRUTURA — JOÃO GOBIRA (SIGA À RISCA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LAYOUTS DISPONÍVEIS (use APENAS estes 8 + os específicos de formato):
Carrossel: "capa", "minimal-void", "bento-grid", "numbered-list", "dark-quote-pull", "midnight-tabela-compara-o", "testimonial-stack", "social-proof-cta-direto"
YouTube: "clean-youtube-thumb" | Story/Vertical: "story-a-capa-glow" | Meta Ads: "bento-modern-ad" | Banner: "banner-a-dark-split-cta"

REGRA #1 — VARIEDADE OBRIGATÓRIA:
Nunca repita o mesmo layout em slides consecutivos.
"minimal-void" pode aparecer até 2x. Todos os outros: máximo 1x por carrossel.

REGRA #2 — ARQUITETURA DE CARROSSEL:
Posição 1 → CAPA: layout:"capa" com foto do João, varie o variant a cada carrossel
Posição 2 → PROBLEMA/TENSÃO: "minimal-void" ou "dark-quote-pull" — frase brutal, bg:""
Posição 3 → DADO/PROVA: "bento-grid" — resultados concretos com números, bg:""
Posição 4 → MÉTODO/PASSO A PASSO: "numbered-list" — framework acionável, bg:""
Posição 5 → COMPARAÇÃO/INSIGHT: "midnight-tabela-compara-o" ou "dark-quote-pull", bg:""
Posição 6 → PROVA SOCIAL: "testimonial-stack" — resultado de cliente ou aluno, bg:""
Posição 7+ → CTA FINAL: "social-proof-cta-direto" com foto do João no bg

REGRA #3 — MAPEAMENTO CONTEÚDO → LAYOUT:
- Múltiplos resultados/números (faturamento, crescimento, ROI)? → "bento-grid" (HTML bento-2x2 no body)
- Framework, dicas, passo a passo, erros numerados? → "numbered-list" (HTML num-list no body)
- Comparação dois perfis/cenários (antes/depois)? → "midnight-tabela-compara-o" (HTML comp-table no body)
- Frase de impacto, citação do João, insight? → "dark-quote-pull"
- Resultado de cliente, depoimento? → "testimonial-stack" (HTML testimonial-card no body)
- CTA final com prova de resultado? → "social-proof-cta-direto" (HTML sp-row no body)
- Impacto textual puro, dado chocante, provocação? → "minimal-void"

REGRA #4 — CAPA PARAMÉTRICA (layout:"capa") — OBRIGATÓRIO:
Sempre envie o campo params com variant e badge. Varie o variant a cada criativo:
- params:{variant:"split-left", badge:"bl"} — foto direita, texto esquerda, badge inf-esq
- params:{variant:"split-right", badge:"br"} — foto esquerda, texto direita, badge inf-dir
- params:{variant:"top-photo", badge:"bl"} — foto superior, headline inferior, badge inf-esq
- params:{variant:"blur-hero", badge:"br"} — foto fullscreen desfocada, texto centrado-baixo
- badge pode ser: "bl", "br", "tl", "tr", "none" — varie conforme a composição

REGRA #5 — FUNDO (bg):
- Capa e CTA final: "joao-gobira.JPG" ou foto de upload recente — OBRIGATÓRIO
- Luta/esporte: use foto de treino se disponível
- Todos os outros slides: bg:"" (foto distrai do dado)`;

  const systemInstruction = editModeContext + `Você é o co-criador oficial de criativos do Studio.
Seu objetivo é gerar a copy e estrutura de slides de um criativo brutalista/moderno de alta conversão.

FORMATO DO CRIATIVO SOLICITADO: "${format}"
Considere as diretrizes do formato solicitado para compor títulos e copys:
- "carousel" ou "linkedin-carousel": Carrossel (1080x1350px). Média de 5 a 10 slides. Texto fluido, bem sequenciado.
- "square" ou "meta-portrait": Meta Ads Estático (1080x1080 ou 4:5). Copy extremamente direta, headline curtíssima, focado em benefícios múltiplos. LAYOUT RECOMENDADO: "bento-modern-ad".
- "vertical": Meta Ads Stories / Reels (1080x1920px). Máximo 1 slide ultra impactante para story, layout super elegante, vertical. LAYOUT RECOMENDADO: "modern-glass-story".
- "horizontal" ou "banner-horizontal": Banner largo (1920x1080px). Um único slide de capa muito largo. Texto único. LAYOUT RECOMENDADO: "mesh-banner-widescreen".
- "youtube-thumb": Capa de YouTube (1280x720). Título super massivo (máx 5 palavras fortes), foco em clique/CTR. LAYOUT RECOMENDADO: "clean-youtube-thumb".

${structureRules}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE COPYWRITING BRUTALISTA (SIGA À RISCA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COPY #1 — TÍTULOS CURTOS E DIRETOS:
Máximo 8 palavras. Ideal: 4–6.
Sempre começar com verbo no imperativo OU número concreto.
✅ "3 erros que destroem sua campanha" / "Você ignorou este dado"
❌ "Como potencializar seus resultados com as melhores estratégias de marketing digital"
Use <em> em UMA palavra-chave do título para destaque visual.

COPY #2 — CORPO OBJETIVO (max 3 linhas):
Cada linha = 1 ideia completa. Sem subordinadas longas.
✅ "CPA caiu 38%. Em 21 dias. Sem mudar o orçamento."
❌ "Ao implementar o método correto de rastreamento, observamos uma melhora significativa nos indicadores de performance."
Se o layout JÁ TEM componente visual (barras, tabela, lista), o body deve ser vazio "" — o dado já fala por si.

COPY #3 — NÚMEROS PRIMEIRO:
Se o slide tem dado, o número abre a frase.
✅ "+320% de vendas em 60 dias" / "R$4M em receita rastreada este ano"
❌ "Aumento expressivo de mais de trezentos por cento nas vendas"

COPY #4 — PALAVRAS PROIBIDAS (jamais use):
transforme, potencialize, otimize, alavanque, impulsione, maximize, revolucione, eleve, escale sua vida,
"nível outro", "como nunca antes", "resultados extraordinários", "jornada", "ecossistema de marketing",
"mindset", "conteúdo de valor", "estratégia robusta", "de forma eficaz", "com excelência", "soluções inovadoras"

COPY #5 — VOZ E TOM:
Tom: consultor sênior que já errou e aprendeu. Direto, sem floreio, sem hype vazio.
Falar para UMA pessoa: use "você" (nunca "vocês").
Âncoras de credibilidade: "12 anos", "R$2M+", "47 clientes", "+320% em 30 dias" — números reais dão peso.
CTA sempre concreto: "Link na bio." / "Me chama no direct." / "Salva esse slide."

REPOSITÓRIO DE MODELOS VISUAIS (LAYOUTS):
Siga as REGRAS DE ESTRUTURA acima para decidir o layout de cada slide. Nunca repita o mesmo layout em slides consecutivos. Os layouts abaixo são todos aprovados — use-os com variedade conforme o tipo de conteúdo do slide.
Aqui estão os modelos visuais e layouts cadastrados e aprovados:
${modelosStr}

REGRAS DE IMAGENS & FOTOGRAFIAS:
${imagensStr}

A sua escolha de imagem para o campo "bg" deve ser altamente estratégica e lógica com base no teor do slide:
- Use imagens de fundo adequadas para a marca. Para TagServer, não use fotos do João Gobira, use fotos conceituais ou sem fundo ("").
- Para João Gobira, use preferencialmente "joao-gobira.JPG" para Capa e CTA, e outras fotos do acervo dependendo do assunto (luta, palco, reuniões).
- Se o usuário carregou novas fotos, elas aparecerão com o prefixo "upload_timestamp_nome.png". Use-as!
- Se o slide requerer foco puramente textual, deixe o campo "bg" vazio "" para fundo sólido.

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


NOVOS LAYOUTS COMPLEXOS (Se usar esses layouts, envie o HTML correspondente no s.body):

PARA O LAYOUT "bento-grid", envie no campo "body" esta estrutura HTML:
<div class="bento bento-2x2" style="height: 640px;">
              <div class="bento-cell bento-big" style="background: var(--iron); justify-content: flex-start; gap: 0; padding: 40px;">
                <div class="mtag lime" style="font-size: 16px; margin-bottom: 16px;">[DESTAQUE]</div>
                <div class="bento-n" style="font-size: 120px; color: var(--fire);">+165K</div>
                <div class="bento-lbl">eventos de compra em 30 dias</div>
              </div>
              <div class="bento-cell" style="background: var(--carbon);">
                <div class="bento-n gold">47%</div>
                <div class="bento-lbl">VENDAS REAIS</div>
              </div>
              <div class="bento-cell" style="background: var(--iron); border-left: 3px solid var(--fire);">
                <div class="bento-n" style="font-size: 72px;">0,8x</div>
                <div class="bento-lbl">CPA MANTIDO</div>
              </div>
            </div>
    

PARA O LAYOUT "testimonial-stack", envie no campo "body" esta estrutura HTML:
<div class="testimonial-card">
            <div class="testimonial-stars">
              <div class="star"></div><div class="star"></div><div class="star"></div>
              <div class="star"></div><div class="star"></div>
            </div>
            <div class="testimonial-text">
              "Depois de 3 semanas com o TagServer, nosso CPA caiu 28% e as campanhas passaram a otimizar de verdade. O algoritmo finalmente tinha dados para trabalhar."
            </div>
            <div class="testimonial-author">Carlos Mendes</div>
            <div class="testimonial-company">// Head de Performance · E-commerce</div>
          </div>
    

PARA O LAYOUT "light-editorial-dados", envie no campo "body" barras de comparação adaptadas ao tema (substitua os rótulos e percentuais pelos dados reais do conteúdo):
<div style="display:flex; flex-direction:column; gap:24px;">
  <div>
    <div style="display:flex; justify-content:space-between; font-family:var(--fm); font-size:16px; color:#666; letter-spacing:2px; margin-bottom:8px;">
      <span>CENÁRIO ANTERIOR</span><span>34%</span>
    </div>
    <div style="height: 12px; background: #DDD; width: 100%;">
      <div style="height:100%; width:34%; background:#999;"></div>
    </div>
  </div>
  <div>
    <div style="display:flex; justify-content:space-between; font-family:var(--fm); font-size:16px; color:var(--fire); letter-spacing:2px; margin-bottom:8px;">
      <span style="font-weight:700;">MÉTODO APLICADO</span><span style="font-weight:700;">91%</span>
    </div>
    <div style="height: 12px; background: #DDD; width: 100%;">
      <div style="height:100%; width:91%; background:var(--fire);"></div>
    </div>
  </div>
</div>
Adapte: rótulos, valores e porcentagens devem refletir os dados reais do slide. Pode ter até 4 barras.


PARA O LAYOUT "story-e-price-oferta", envie no campo "body" esta estrutura HTML:
<div class="price-block" style="margin-bottom: 56px;">
            <div class="price-from">de R$ 1.997</div>
            <div class="price-main">R$997</div>
            <div class="price-period">// pagamento único</div>
            <div class="price-features">
              <div class="price-feat">Implementação completa CAPI</div>
              <div class="price-feat">Configuração Server-Side</div>
              <div class="price-feat">Score de qualidade ≥ 8.0</div>
              <div class="price-feat">Suporte 30 dias incluso</div>
            </div>
          </div>
    

PARA O LAYOUT "banner-c-light-editorial-awareness", envie no campo "body" esta estrutura HTML:
<div style="position:absolute; right:0; top:0; width:48%; height:100%; padding: 52px 72px 52px 56px; display:flex; flex-direction:column; justify-content:center; z-index:10;">
          <div style="font-family: var(--fd); font-size: 52px; color: var(--bone); line-height: 1; letter-spacing: 2px; margin-bottom: 16px;">JOÃO GOBIRA</div>
          <div style="font-family: var(--fb); font-size: 26px; font-weight: 300; color: rgba(240,235,224,0.6); line-height: 1.5;">12 anos construindo máquinas de Growth com dados reais.</div>
        </div>
    

PARA O LAYOUT "midnight-social-proof", envie no campo "body" esta estrutura HTML:
<div class="sp-row" style="border-color: rgba(108,92,231,0.2);">
            <div class="sp-item">
              <div class="sp-num" style="color: var(--mid-acc);">R$2M+</div>
              <div class="sp-lbl">Em vendas atribuídas</div>
            </div>
            <div class="sp-item">
              <div class="sp-num" style="color: var(--mid-gold);">87</div>
              <div class="sp-lbl">Clientes ativos</div>
            </div>
            <div class="sp-item">
              <div class="sp-num" style="color: rgba(248,249,250,0.8);">4.9★</div>
              <div class="sp-lbl">Avaliação média</div>
            </div>
          </div>
    

PARA O LAYOUT "social-proof-cta-direto", envie no campo "body" esta estrutura HTML:
<div class="sp-row" style="padding: 32px 0; border-color: var(--iron);">
            <div class="sp-item">
              <div class="sp-num gold" style="font-size: 96px;">+47%</div>
              <div class="sp-lbl">Vendas reais</div>
            </div>
            <div class="sp-item">
              <div class="sp-num" style="font-size: 96px; color: var(--bone);">165K</div>
              <div class="sp-lbl">Eventos recuperados</div>
            </div>
          </div>


PARA O LAYOUT "numbered-list", envie no campo "body" esta estrutura HTML (adapte os textos ao tema):
<div class="num-list">
  <div class="num-item">
    <div class="num-n">01</div>
    <div class="num-body">
      <div class="num-title">DIAGNÓSTICO</div>
      <div class="num-sub">Mapeie o gargalo real antes de qualquer ação.</div>
    </div>
  </div>
  <div class="num-item">
    <div class="num-n">02</div>
    <div class="num-body">
      <div class="num-title">ESTRUTURA</div>
      <div class="num-sub">Monte o sistema e valide cada etapa.</div>
    </div>
  </div>
  <div class="num-item">
    <div class="num-n">03</div>
    <div class="num-body">
      <div class="num-title">ESCALA</div>
      <div class="num-sub">Com dados precisos, otimize e escale sem achismo.</div>
    </div>
  </div>
</div>


PARA O LAYOUT "score-progress", envie no campo "body" esta estrutura HTML (adapte métricas ao tema):
<div class="score-bar-wrap">
  <div class="score-row">
    <div class="score-label-row">
      <div class="score-lbl">Métrica Principal</div>
      <div class="score-val c-fire">94%</div>
    </div>
    <div class="score-track"><div class="score-fill" style="width: 94%;"></div></div>
  </div>
  <div class="score-row">
    <div class="score-label-row">
      <div class="score-lbl">Eficiência</div>
      <div class="score-val c-gold">87%</div>
    </div>
    <div class="score-track"><div class="score-fill c-gold" style="width: 87%;"></div></div>
  </div>
  <div class="score-row">
    <div class="score-label-row">
      <div class="score-lbl">ROI Médio</div>
      <div class="score-val">72%</div>
    </div>
    <div class="score-track"><div class="score-fill" style="width: 72%;"></div></div>
  </div>
</div>


PARA O LAYOUT "checklist", envie no campo "body" esta estrutura HTML (adapte itens ao tema):
<div class="checklist">
  <div class="check-item done">
    <div class="check-icon">✓</div>
    <div class="check-text">Primeiro item concluído</div>
  </div>
  <div class="check-item done">
    <div class="check-icon">✓</div>
    <div class="check-text">Segundo item concluído</div>
  </div>
  <div class="check-item">
    <div class="check-icon">○</div>
    <div class="check-text">Terceiro item pendente</div>
  </div>
  <div class="check-item">
    <div class="check-icon">○</div>
    <div class="check-text">Quarto item pendente</div>
  </div>
</div>


PARA O LAYOUT "timeline", envie no campo "body" esta estrutura HTML (adapte etapas ao tema):
<div class="timeline">
  <div class="tl-item">
    <div class="tl-left">
      <div class="tl-dot"></div>
      <div class="tl-line"></div>
    </div>
    <div class="tl-body">
      <div class="tl-year">ETAPA 01</div>
      <div class="tl-title">DIAGNÓSTICO</div>
      <div class="tl-desc">Auditoria e mapeamento do estado atual.</div>
    </div>
  </div>
  <div class="tl-item">
    <div class="tl-left">
      <div class="tl-dot"></div>
      <div class="tl-line"></div>
    </div>
    <div class="tl-body">
      <div class="tl-year">ETAPA 02</div>
      <div class="tl-title">IMPLEMENTAÇÃO</div>
      <div class="tl-desc">Estrutura ativa e validada.</div>
    </div>
  </div>
  <div class="tl-item">
    <div class="tl-left">
      <div class="tl-dot"></div>
    </div>
    <div class="tl-body">
      <div class="tl-year">ETAPA 03</div>
      <div class="tl-title">RESULTADOS</div>
      <div class="tl-desc">Métricas melhoradas e escala sustentável.</div>
    </div>
  </div>
</div>


PARA O LAYOUT "dark-icon-grid-2-2", envie no campo "body" esta estrutura HTML (adapte ícones e textos ao tema):
<div class="icon-grid">
  <div class="icon-cell">
    <div class="icon-sym">⚡</div>
    <div class="icon-title">VELOCIDADE</div>
    <div class="icon-desc">Resultado rápido e mensurável.</div>
  </div>
  <div class="icon-cell">
    <div class="icon-sym">🎯</div>
    <div class="icon-title">PRECISÃO</div>
    <div class="icon-desc">Dados exatos, sem estimativas.</div>
  </div>
  <div class="icon-cell">
    <div class="icon-sym">🔒</div>
    <div class="icon-title">CONTROLE</div>
    <div class="icon-desc">Domínio total do processo.</div>
  </div>
  <div class="icon-cell">
    <div class="icon-sym">📈</div>
    <div class="icon-title">ESCALA</div>
    <div class="icon-desc">Cresce sem perder qualidade.</div>
  </div>
</div>


PARA O LAYOUT "midnight-tabela-compara-o", envie no campo "body" esta estrutura HTML (adapte as linhas ao tema comparativo):
<table class="comp-table">
  <thead>
    <tr>
      <th></th>
      <th>Abordagem Comum</th>
      <th class="highlight">Método Correto</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Resultado</td>
      <td class="no">Inconsistente</td>
      <td class="yes highlight">Previsível</td>
    </tr>
    <tr>
      <td>Custo por Lead</td>
      <td class="no">Alto e variável</td>
      <td class="yes highlight">Controlado</td>
    </tr>
    <tr>
      <td>Escalabilidade</td>
      <td class="no">Limitada</td>
      <td class="yes highlight">Ilimitada</td>
    </tr>
    <tr>
      <td>Tempo de Retorno</td>
      <td class="no">Meses</td>
      <td class="yes highlight">Semanas</td>
    </tr>
  </tbody>
</table>


PARA O LAYOUT "banner-b-tech-lime-produto", envie no campo "body" a coluna direita de funcionalidades (adapte ao produto/tema):
<div style="width:45%; padding: 48px 72px 48px 32px; display:flex; flex-direction:column; justify-content:center; gap:16px;">
  <div style="font-family: var(--fm); font-size: 14px; letter-spacing: 3px; color: var(--ts-lime); text-transform: uppercase; margin-bottom: 8px;">// BENEFÍCIOS</div>
  <div style="display:flex; align-items:center; gap:16px; padding: 16px 20px; border: 1px solid var(--ts-edge);">
    <div style="color: var(--ts-lime); font-family: var(--fm); font-size: 20px;">→</div>
    <div style="font-family: var(--fc); font-size: 24px; color: var(--bone); font-weight: 600;">Benefício Principal</div>
  </div>
  <div style="display:flex; align-items:center; gap:16px; padding: 16px 20px; border: 1px solid var(--ts-edge);">
    <div style="color: var(--ts-lime); font-family: var(--fm); font-size: 20px;">→</div>
    <div style="font-family: var(--fc); font-size: 24px; color: var(--bone); font-weight: 600;">Segundo Benefício</div>
  </div>
  <div style="display:flex; align-items:center; gap:16px; padding: 16px 20px; border: 1px solid var(--ts-line); background: rgba(184,233,43,0.05);">
    <div style="color: var(--ts-lime); font-family: var(--fm); font-size: 20px;">→</div>
    <div style="font-family: var(--fc); font-size: 24px; color: var(--ts-lime); font-weight: 700;">Diferencial Exclusivo</div>
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

PARA O LAYOUT "bento-grid" COM COMPONENTE KPI ROW (alternativa mais limpa ao bento-2x2 para 2–3 métricas):
Substitua o body por um kpi-row quando tiver 2 ou 3 métricas principais:
<div class="kpi-row">
  <div class="kpi-item">
    <div class="kpi-val fire">+47%</div>
    <div class="kpi-lbl">Vendas reais</div>
  </div>
  <div class="kpi-sep"></div>
  <div class="kpi-item">
    <div class="kpi-val gold">R$2M</div>
    <div class="kpi-lbl">Receita atribuída</div>
  </div>
  <div class="kpi-sep"></div>
  <div class="kpi-item">
    <div class="kpi-val">-38%</div>
    <div class="kpi-lbl">Redução de CPA</div>
  </div>
</div>


NOVO COMPONENTE: DONUT CHART (use no layout "bento-grid" ou "minimal-void" quando tiver 1 percentual dominante):
<div class="donut-wrap">
  <div class="donut" style="background: conic-gradient(var(--fire) 0% 73%, var(--iron) 73% 100%);">
    <div class="donut-hole">
      <div class="donut-val">73%</div>
      <div class="donut-lbl">ROAS</div>
    </div>
  </div>
  <div class="donut-legend">
    <div class="donut-item"><span class="donut-dot" style="background:var(--fire);"></span>Com método</div>
    <div class="donut-item"><span class="donut-dot" style="background:var(--iron);"></span>Sem método</div>
  </div>
</div>
Adapte: o conic-gradient reflete o percentual (ex: 87% → 87% 13%). Use --fire para a fatia principal.


NOVO COMPONENTE: FUNIL DE CONVERSÃO (use no layout "numbered-list" ou "bento-grid" para dados de funil):
<div class="funnel-chart">
  <div class="funnel-stage" style="width:100%;">
    <div class="funnel-bar" style="background:var(--iron);">
      <span class="funnel-label">TRÁFEGO</span><span class="funnel-val">10.000</span>
    </div>
  </div>
  <div class="funnel-stage" style="width:72%;">
    <div class="funnel-bar" style="background:var(--steel);">
      <span class="funnel-label">CLIQUES</span><span class="funnel-val">7.200</span>
    </div>
  </div>
  <div class="funnel-stage" style="width:38%;">
    <div class="funnel-bar" style="background:var(--gold); opacity:0.85;">
      <span class="funnel-label">LEADS</span><span class="funnel-val">3.800</span>
    </div>
  </div>
  <div class="funnel-stage" style="width:14%;">
    <div class="funnel-bar" style="background:var(--fire);">
      <span class="funnel-label">VENDAS</span><span class="funnel-val">1.400</span>
    </div>
  </div>
</div>
Adapte: larguras das stages (%) refletem proporcionalmente os volumes de cada etapa do funil.


NOVO COMPONENTE: TREND LINE (use no layout "bento-grid" quando mostrar crescimento ao longo do tempo):
<div class="trend-wrap">
  <div class="trend-label">CRESCIMENTO MENSAL — JAN → AGO</div>
  <svg viewBox="0 0 320 88" class="trend-svg" preserveAspectRatio="none">
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--fire)" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="var(--fire)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="10,80 50,65 90,55 130,42 170,28 210,18 260,10 310,4 310,88 10,88" fill="url(#tg)"/>
    <polyline points="10,80 50,65 90,55 130,42 170,28 210,18 260,10 310,4" fill="none" stroke="var(--fire)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="310" cy="4" r="5" fill="var(--fire)"/>
  </svg>
  <div class="trend-vals">
    <span class="trend-start">Jan: R$120K</span>
    <span class="trend-end">Ago: R$680K</span>
  </div>
</div>
Adapte: os pontos do polyline refletem os valores reais (y=0 é topo, y=88 é base). Ajuste os valores de texto.


Importante: Ao usar componentes nativos (custom-chart, vs-container, step-list, kpi-row, donut-wrap, funnel-chart, trend-wrap), o campo "body" deve conter APENAS o HTML do componente, e o bg deve ser "". Para os layouts estruturados (numbered-list, bento-grid, testimonial-stack, etc.), o body deve conter o HTML específico descrito acima.

FORMATO DE RESPOSTA (OBRIGATÓRIO):
Responda UNICAMENTE com um objeto JSON puro, sem blocos de código markdown ou explicações fora do JSON.

Para PATCH (alteração de 1–2 campos de 1 slide):
{ "assistantMessage": "...", "action": "patch", "targetIndex": 0, "patch": {"bg": "joao-gobira.JPG"} }

Para REPLACE (reescrever 1 slide inteiro):
{ "assistantMessage": "...", "action": "replace", "targetIndex": 2, "slides": [{ "type":"conteudo", "layout":"bento-grid", "tag":"...", "title":"...", "body":"...", "bg":"" }] }

Para INSERT_AFTER (inserir slide novo após posição):
{ "assistantMessage": "...", "action": "insert_after", "targetIndex": 3, "slides": [{ ...slide completo... }] }

Para DELETE:
{ "assistantMessage": "...", "action": "delete", "targetIndex": 2 }

Para FULL (criação ou refazer tudo):
{
  "assistantMessage": "Mensagem inspiradora sobre a estratégia do criativo.",
  "action": "full",
  "slides": [
    { "type": "capa", "layout": "capa", "tag": "CATEGORIA", "title": "TÍTULO<br>COM <em>DESTAQUE</em>", "body": "Subtítulo direto.", "bg": "joao-gobira.JPG", "params": {"variant": "split-left", "badge": "bl"} },
    { "type": "conteudo", "layout": "minimal-void", "tag": "DADO CHOCANTE", "title": "3 EM CADA 4<br><em>CAMPANHAS</em><br>VAZAM DADOS.", "body": "", "bg": "" },
    { "type": "conteudo", "layout": "bento-grid", "tag": "RESULTADOS REAIS", "title": "O QUE MUDA", "body": "<div class=\"bento bento-2x2\" style=\"height:640px;\">...</div>", "bg": "" },
    { "type": "conteudo", "layout": "numbered-list", "tag": "MÉTODO", "title": "3 PASSOS", "body": "<div class=\"num-list\">...</div>", "bg": "" },
    { "type": "cta", "layout": "social-proof-cta-direto", "tag": "RESULTADO", "title": "TORNE-SE UM<br><em>BUILDER.</em>", "body": "<div class=\"sp-row\">...</div>", "bg": "joao-gobira.JPG" }
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
  const { name, slides, format = 'carousel', brandId = 'jg', preview = false } = req.body;
  if (!slides || slides.length === 0 || (!preview && !name)) {
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


  const getAuthorBadge = (pos = 'bl') => {
    const posMap = { bl: 'bottom:60px; left:64px;', br: 'bottom:60px; right:64px;', tl: 'top:72px; left:64px;', tr: 'top:72px; right:64px;' };
    const p = posMap[pos] || posMap.bl;
    if (pos === 'none') return '';
    if (brandId === 'jg') return `<div style="position:absolute; ${p} z-index:50; display:flex; align-items:center; gap:18px; padding:14px 28px 14px 14px; background:rgba(8,8,8,0.88); border:2px solid var(--steel);">
  <div style="width:68px; height:68px; border-radius:50%; border:3px solid var(--fire); background-image:url('../Carrosseis/joao-gobira.JPG'); background-size:cover; background-position:center top; flex-shrink:0;"></div>
  <div>
    <div style="font-family:var(--fd); font-size:30px; color:var(--bone); letter-spacing:1px; line-height:1;">JOÃO GOBIRA</div>
    <div style="font-family:var(--fm); font-size:11px; color:var(--fire); letter-spacing:2px; text-transform:uppercase; margin-top:5px;">// Growth · Gestão</div>
  </div>
</div>`;
    return `<div style="position:absolute; ${p} z-index:50; display:flex; align-items:center; gap:18px; padding:14px 28px 14px 14px; background:rgba(14,18,23,0.92); border:2px solid var(--ts-edge);">
  <div style="width:68px; height:68px; border-radius:50%; border:3px solid var(--ts-lime); background:var(--ts-card); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
    <span style="font-family:var(--fm); font-size:20px; color:var(--ts-lime); font-weight:700; letter-spacing:1px;">TS</span>
  </div>
  <div>
    <div style="font-family:var(--fd); font-size:30px; color:var(--bone); letter-spacing:1px; line-height:1;">TAGSERVER</div>
    <div style="font-family:var(--fm); font-size:11px; color:var(--ts-lime); letter-spacing:2px; text-transform:uppercase; margin-top:5px;">// Server-Side Tracking</div>
  </div>
</div>`;
  };
  const authorBadgeHtml = getAuthorBadge('bl');

  let slidesHtml = '';
  slides.forEach((s, idx) => {
    const slideNo = `${String(idx + 1).padStart(2, '0')}/${String(slides.length).padStart(2, '0')}`;
    const bgUrl = s.bg ? `../${s.bg}` : '';
    const layoutClass = `layout-${s.layout || 'split-screen'}`;
    const accentMap = { fire: '#C8391A', gold: '#B8922A', neon: '#E1306C', bone: '#F0EBE0' };
    const accentVar = accentMap[s.accentColor] ? `--fire:${accentMap[s.accentColor]};` : '';
    
    let isSocialProof = s.layout === 'social-proof';
    let isGiantNumber = s.layout === 'giant-number';
    let isModernGlassStory = s.layout === 'modern-glass-story';
    let isCleanYoutubeThumb = s.layout === 'clean-youtube-thumb';
    let isBentoModernAd = s.layout === 'bento-modern-ad';
    let isMeshBannerWidescreen = s.layout === 'mesh-banner-widescreen';
    // Layouts com handler dedicado têm prioridade sobre o type
    const hasOwnHandler = [
      'capa',
      'bento-grid','numbered-list','score-progress','testimonial-stack','checklist','timeline',
      'dark-quote-pull','dark-icon-grid-2-2','light-editorial-capa','light-editorial-dados',
      'story-a-capa-glow','story-b-n-mero-gigante','story-c-tech-code','story-d-light-editorial',
      'story-e-price-oferta','banner-a-dark-split-cta','banner-b-tech-lime-produto',
      'banner-c-light-editorial-awareness','banner-d-youtube-thumbnail-style',
      'midnight-capa-premium','midnight-social-proof','midnight-tabela-compara-o',
      'lead-form-dark','social-proof-cta-direto',
      'social-proof','giant-number','modern-glass-story','clean-youtube-thumb','bento-modern-ad','mesh-banner-widescreen'
    ].includes(s.layout);
    let isCapa = s.type === 'capa' && !hasOwnHandler;
    let isCta = s.type === 'cta' && !hasOwnHandler;
    let isQuote = s.type === 'quote' && !hasOwnHandler;
    console.log(`[slide ${(idx+1)}] type:${s.type} layout:${s.layout} → hasOwnHandler:${hasOwnHandler} isCapa:${isCapa} isCta:${isCta}`);

    slidesHtml += `\n<!-- SLIDE ${idx + 1}: ${s.type.toUpperCase()} -->\n`;
    
    if (isModernGlassStory) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  ${bgUrl ? `<div class="photo-bg" style="position: absolute; inset: 0; background-image: url('${bgUrl}'); background-size: cover; background-position: center;"></div>` : ''}
  <div class="cw">
    <div class="mono-tag" style="margin-bottom: 32px; color: rgba(255,255,255,0.6);">${s.tag || 'DESTAQUE'}</div>
    <div class="disp-large" style="font-size: 88px; line-height: 1.0; margin-bottom: 40px; color: #FFF;">
      ${s.title}
    </div>
    <div class="body-copy" style="font-size: 38px; line-height: 1.4;">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isCleanYoutubeThumb) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  ${bgUrl ? `<div class="photo-bg" style="position: absolute; inset: 0; background-image: url('${bgUrl}'); background-size: cover; background-position: center;"></div>` : ''}
  <div class="cw">
    <div class="disp-large">
      ${s.title}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isBentoModernAd) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  <div class="cw">
    <div>
      <div class="mono-tag" style="margin-bottom: 24px; background: rgba(0,0,0,0.05); color: #333; padding: 8px 16px; border-radius: 8px; width: fit-content; border: none;">${s.tag || 'GROWTH'}</div>
      <div class="disp-large" style="line-height: 1.1;">
        ${s.title}
      </div>
    </div>
    <div class="body-copy" style="font-size: 32px; line-height: 1.5; color: #555; padding-top: 32px; border-top: 1px solid rgba(0,0,0,0.1);">
      ${s.body}
    </div>
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isMeshBannerWidescreen) {
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  <div class="cw">
    <div class="disp-large" style="line-height: 1.0;">
      ${s.title}
    </div>
    ${s.body ? `<div class="body-copy" style="font-size: 36px; margin-top: 40px; color: rgba(255,255,255,0.8); max-width: 1200px; margin-left: auto; margin-right: auto;">${s.body}</div>` : ''}
  </div>
</div>\n<div class="sep"></div>\n`;
    } else if (isSocialProof) {
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
    } else if (s.layout === 'capa') {
      // Parametric capa: reads s.params for variant + badge
      const sp = (() => { try { return typeof s.params === 'object' ? (s.params || {}) : (s.params ? JSON.parse(s.params) : {}); } catch { return {}; } })();
      const variant = sp.variant || 'split-left';
      const badge = getAuthorBadge(sp.badge || 'bl');

      if (variant === 'split-right') {
        // Photo LEFT, text RIGHT
        slidesHtml += `<div class="slide ${slideClass} layout-capa-split-right" id="slide-${idx + 1}" style="background:var(--void);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire" style="left:auto;right:0;"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>
  ${bgUrl ? `
  <div style="position:absolute;top:0;left:0;bottom:0;width:50%;background-image:url('${bgUrl}');background-size:cover;background-position:center top;z-index:1;border-right:2px solid var(--steel);filter:grayscale(25%) contrast(1.1) brightness(0.88);"></div>
  <div style="position:absolute;top:0;left:0;bottom:0;width:50%;background:linear-gradient(to left,var(--void) 0%,rgba(8,8,8,0) 30%);z-index:2;"></div>
  <div style="position:absolute;bottom:0;left:0;width:50%;height:45%;background:linear-gradient(to bottom,rgba(8,8,8,0) 0%,var(--void) 100%);z-index:3;"></div>` : ''}
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="width:50%;margin-left:auto;justify-content:flex-end;padding:80px 80px 130px 48px;gap:0;">
    <div class="mono-tag" style="margin-bottom:40px;">${s.tag || 'GROWTH'}</div>
    <div class="h-line h-line-fire"></div>
    <div class="disp-large" style="font-size:112px;line-height:0.88;margin-bottom:44px;">${s.title}</div>
    ${s.body ? `<div class="body-copy" style="font-size:32px;">${s.body}</div>` : ''}
  </div>
  ${badge}
</div>\n<div class="sep"></div>\n`;

      } else if (variant === 'top-photo') {
        // Photo TOP 52%, text BOTTOM
        slidesHtml += `<div class="slide ${slideClass} layout-capa-top-photo" id="slide-${idx + 1}" style="background:var(--void);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>
  ${bgUrl ? `
  <div style="position:absolute;top:0;left:0;right:0;height:52%;background-image:url('${bgUrl}');background-size:cover;background-position:center 20%;z-index:1;filter:grayscale(20%) contrast(1.1) brightness(0.85);"></div>
  <div style="position:absolute;top:28%;left:0;right:0;height:28%;background:linear-gradient(to bottom,transparent 0%,var(--void) 100%);z-index:2;"></div>` : ''}
  <div style="position:absolute;bottom:0;left:0;right:0;height:52%;background:var(--void);z-index:1;"></div>
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="position:absolute;bottom:0;left:0;right:0;height:54%;justify-content:flex-end;padding:0 88px 88px 92px;gap:0;">
    <div class="mono-tag" style="margin-bottom:28px;font-size:22px;">${s.tag || 'GROWTH'}</div>
    <div class="h-line h-line-fire" style="margin-bottom:28px;"></div>
    <div class="disp-large" style="font-size:104px;line-height:0.88;margin-bottom:32px;">${s.title}</div>
    ${s.body ? `<div class="body-copy" style="font-size:30px;">${s.body}</div>` : ''}
  </div>
  ${badge}
</div>\n<div class="sep"></div>\n`;

      } else if (variant === 'blur-hero') {
        // Photo FULLSCREEN with overlay, text center→bottom, centered
        slidesHtml += `<div class="slide ${slideClass} layout-capa-blur-hero" id="slide-${idx + 1}" style="background:var(--void);">
  <div class="grain"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>
  <div class="tape-h tape-h-bottom tape-h-fire"></div>
  ${bgUrl ? `
  <div style="position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;filter:brightness(0.52) contrast(1.12) grayscale(15%);z-index:1;"></div>
  <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(8,8,8,0.1) 0%,rgba(8,8,8,0.3) 40%,rgba(8,8,8,0.88) 72%,rgba(8,8,8,1) 100%);z-index:2;"></div>` : ''}
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="justify-content:flex-end;padding-bottom:96px;gap:0;text-align:center;align-items:center;">
    <div class="mono-tag" style="margin-bottom:40px;justify-content:center;">${s.tag || 'GROWTH'}</div>
    <div class="h-line h-line-fire" style="margin:0 auto 40px;"></div>
    <div class="disp-large" style="font-size:120px;line-height:0.88;margin-bottom:44px;max-width:900px;">${s.title}</div>
    ${s.body ? `<div class="body-copy" style="font-size:34px;text-align:center;max-width:760px;">${s.body}</div>` : ''}
  </div>
  ${badge}
</div>\n<div class="sep"></div>\n`;

      } else {
        // split-left (default): text LEFT, photo RIGHT
        slidesHtml += `<div class="slide ${slideClass} layout-capa-split-left" id="slide-${idx + 1}" style="background:var(--void);">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>
  ${bgUrl ? `<div class="split-bg" style="background-image:url('${bgUrl}');filter:grayscale(28%) contrast(1.1) brightness(0.9);"></div><div class="split-gradient"></div><div class="split-gradient-bottom"></div>` : ''}
  <div class="slide-no">${slideNo}</div>
  <div class="cw" style="width:55%;justify-content:flex-end;padding-right:0;padding-bottom:140px;gap:0;">
    <div class="mono-tag" style="margin-bottom:40px;">${s.tag || 'GROWTH'}</div>
    <div class="h-line h-line-fire"></div>
    <div class="disp-large" style="font-size:116px;line-height:0.88;margin-bottom:44px;">${s.title}</div>
    ${s.body ? `<div class="body-copy" style="font-size:34px;">${s.body}</div>` : ''}
  </div>
  ${badge}
</div>\n<div class="sep"></div>\n`;
      }

    } else if (isCapa) {
      const capaLayout = s.layout || 'split-screen';
      const cwStyle = (!s.layout || s.layout === 'split-screen')
        ? `style="width: 55%; padding-right: 0; justify-content: flex-end; padding-bottom: 140px; gap: 0;"`
        : '';
      const titleStyle = (!s.layout || s.layout === 'split-screen')
        ? `style="font-size: 116px; line-height: 0.88; margin-bottom: 44px;"`
        : `style="margin-bottom: 44px;"`;
      const bodyStyle = (!s.layout || s.layout === 'split-screen')
        ? `style="font-size: 34px;"`
        : '';
      slidesHtml += `<div class="slide ${slideClass} ${layoutClass}" id="slide-${idx + 1}">
  <div class="grain"></div>
  <div class="tape-v tape-v-fire"></div>
  <div class="tape-h tape-h-top tape-h-fire"></div>

  ${bgUrl ? `<div class="split-bg" style="background-image: url('${bgUrl}'); filter: grayscale(30%) contrast(1.1) brightness(0.9);"></div><div class="split-gradient"></div><div class="split-gradient-bottom"></div>` : ''}

  <div class="slide-no">${slideNo}</div>

  <div class="cw" ${cwStyle}>
    <div class="mono-tag" style="margin-bottom: 40px;">${s.tag || 'GROWTH EXECUÇÃO'}</div>
    <div class="h-line h-line-fire"></div>

    <div class="disp-large" ${titleStyle}>
      ${s.title}
    </div>

    <div class="body-copy" ${bodyStyle}>
      ${s.body}
    </div>
  </div>
  ${authorBadgeHtml}
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
  ${authorBadgeHtml}
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
        } else if (s.layout === 'bento-grid') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="tape-t c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: space-between;">
          <div>
            <div class="mtag" style="margin-bottom: 36px;">${s.tag || 'DESTAQUE'}</div>
            <div class="hl hl-md c-fire" style="margin-bottom: 36px;"></div>
            <div class="disp" style="font-size: 100px; margin-bottom: 48px; line-height: 0.88;">
      ${s.title}
    </div>
          </div>
          <div>
            
      ${s.body}
    
          </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'numbered-list') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-gold"></div>
        <div class="sn" style="color: var(--steel);">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag gold" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-gold" style="margin-bottom: 40px;"></div>
          <div class="disp" style="font-size: 88px; margin-bottom: 56px; line-height: 0.9;">
      ${s.title}
    </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'score-progress') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-fire" style="margin-bottom: 40px;"></div>
          <div class="disp" style="font-size: 88px; margin-bottom: 56px;">
      ${s.title}
    </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'testimonial-stack') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="tape-b c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag" style="margin-bottom: 48px;">${s.tag || 'DESTAQUE'}</div>
          <div class="disp" style="font-size: 72px; margin-bottom: 64px; line-height: 0.95;">
      ${s.title}
    </div>
          
          
        
      ${s.body}
    </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'checklist') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-fire" style="margin-bottom: 40px;"></div>
          <div class="disp" style="font-size: 88px; margin-bottom: 48px;">
      ${s.title}
    </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'timeline') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-gold"></div>
        <div class="sn" style="color: var(--steel);">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag gold" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-gold" style="margin-bottom: 40px;"></div>
          <div class="disp" style="font-size: 80px; margin-bottom: 56px;">
      ${s.title}
    </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'dark-quote-pull') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 100px 100px 108px; justify-content: center;">
          <div class="quote-big" style="padding: 60px 60px 60px 80px;">
            <div class="quote-bg-mark">"</div>
            <div class="mtag" style="margin-bottom: 40px; position: relative; z-index: 2;">${s.tag || 'DESTAQUE'}</div>
            <div class="disp" style="font-size: 96px; margin-bottom: 40px; position: relative; z-index: 2; line-height: 0.9;">
      ${s.title}
    </div>
            
      ${s.body}
    
          </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'dark-icon-grid-2-2') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="tape-t c-fire"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 88px 88px 80px 96px; justify-content: space-between;">
          <div>
            <div class="mtag" style="margin-bottom: 28px;">${s.tag || 'DESTAQUE'}</div>
            <div class="disp" style="font-size: 84px; margin-bottom: 0; line-height: 0.9;">
      ${s.title}
    </div>
          </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'light-editorial-capa') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square paper-bg" id="slide-${idx + 1}" style="position: relative;">
        
        <div class="grain-light"></div>
        <div class="tape-l c-ink"></div>
        <div class="tape-t c-ink"></div>
        <!-- Red accent block top-right -->
        <div style="position:absolute; top:0; right:0; width:280px; height:280px; background:var(--fire); z-index:2;"></div>
        <!-- Decorative large chapter number -->
        <div style="position:absolute; bottom:180px; left:72px; font-family:var(--fd); font-size:340px; color:rgba(0,0,0,0.045); line-height:1; letter-spacing:-16px; z-index:1; pointer-events:none; user-select:none;">${slideNo}</div>
        <div class="sn" style="color: rgba(0,0,0,0.2); z-index: 45;">${slideNo}</div>
        <div class="cw" style="padding: 88px 88px 80px 96px; justify-content: flex-end; gap: 0; position: relative; z-index: 30;">
          <div class="mtag ink" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-ink" style="margin-bottom: 36px;"></div>
          <div style="font-family: var(--fd); font-size: 96px; color: var(--ink); line-height: 0.88; margin-bottom: 32px; letter-spacing: 2px;">
      ${s.title}
    </div>

      ${s.body}
    </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'light-editorial-dados') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square paper-bg" id="slide-${idx + 1}" style="position: relative;">
        
        <div class="grain-light"></div>
        <div class="tape-l c-ink"></div>
        <div class="tape-b" style="background: var(--fire); height: 8px;"></div>
        <div class="sn" style="color: rgba(0,0,0,0.2);">${slideNo}</div>
        <div class="cw" style="padding: 88px 88px 80px 96px; justify-content: center; gap: 0;">
          <div class="mtag ink" style="margin-bottom: 32px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-ink" style="margin-bottom: 40px;"></div>
          <div style="font-family: var(--fd); font-size: 80px; color: var(--ink); line-height: 0.9; margin-bottom: 56px; letter-spacing: 2px;">
      ${s.title}
    </div>
      ${s.body}
    </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'story-a-capa-glow') {
      slidesHtml += `<div class="slide ${slideClass} fmt-story" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <!-- Glow blobs -->
        <div class="glow-blob" style="width:800px; height:800px; background:var(--fire); opacity:0.07; top:-200px; left:-300px;"></div>
        <div class="glow-blob" style="width:600px; height:600px; background:var(--gold); opacity:0.05; bottom:100px; right:-200px;"></div>
        <div class="tape-l c-fire"></div>
        <div class="tape-t c-fire"></div>
        <div class="tape-b c-fire"></div>
        <!-- Progress bar top -->
        <div style="position:absolute; top:16px; left:16px; right:16px; height:4px; background:rgba(255,255,255,0.15); z-index:60;">
          <div style="height:100%; width:30%; background:white;"></div>
        </div>
        <div class="cw" style="padding: 120px 88px 100px 96px; justify-content: flex-end; gap: 0;">
          <div class="mtag" style="margin-bottom: 40px; font-size: 24px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-fire" style="margin-bottom: 40px;"></div>
          <div class="disp" style="font-size: 140px; margin-bottom: 48px; line-height: 0.86;">
      ${s.title}
    </div>
          <div class="body" style="font-size: 46px; margin-bottom: 64px; border-top: 2px solid var(--iron); padding-top: 40px;">
      ${s.body}
    </div>
          <!-- Swipe up indicator -->
          <div style="margin-top: 64px; display:flex; flex-direction:column; align-items:center; gap:12px;">
            <div style="font-family: var(--fm); font-size: 20px; letter-spacing: 3px; color: rgba(240,235,224,0.5); text-transform: uppercase;">Deslize para ver</div>
            <div style="width:2px; height:60px; background: linear-gradient(to bottom, var(--fire), transparent);"></div>
          </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'story-b-n-mero-gigante') {
      slidesHtml += `<div class="slide ${slideClass} fmt-story" id="slide-${idx + 1}" style="background: var(--fire);">
        
        <div class="grain" style="opacity:0.3;"></div>
        <div class="tape-l c-bone"></div>
        <!-- Giant BG number -->
        <div style="position:absolute; bottom:-100px; right:-120px; font-family: var(--fd); font-size: 900px; color:rgba(0,0,0,0.12); line-height:0.8; pointer-events:none; z-index:2;">
      ${s.title}
    </div>
        <div class="cw" style="padding: 140px 88px 100px 96px; justify-content: center; gap: 0; position:relative; z-index:10;">
          <div class="mtag bone" style="margin-bottom: 48px; font-size: 24px;">${s.tag || 'DESTAQUE'}</div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'story-c-tech-code') {
      slidesHtml += `<div class="slide ${slideClass} fmt-story" id="slide-${idx + 1}" style="background: var(--ts-bg); background-image: radial-gradient(rgba(184,233,43,0.10) 1px, transparent 0); background-size: 32px 32px;">
        
        <div class="tape-l c-lime"></div>
        <div class="tape-t c-lime"></div>
        <!-- Progress -->
        <div style="position:absolute; top:16px; left:16px; right:16px; height:3px; background:rgba(184,233,43,0.2); z-index:60;">
          <div style="height:100%; width:66%; background:var(--ts-lime);"></div>
        </div>
        <div class="cw" style="padding: 120px 88px 100px 96px; justify-content: space-between; gap: 0;">
          <div>
            <div class="mtag lime" style="margin-bottom: 40px; font-size: 22px;">${s.tag || 'DESTAQUE'}</div>
            <div style="font-family: var(--fd); font-size: 120px; color: var(--bone); line-height: 0.88; letter-spacing: 2px; margin-bottom: 48px;">
      ${s.title}
    </div>
            
      ${s.body}
    
          </div>
          <div>
          </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'story-d-light-editorial') {
      slidesHtml += `<div class="slide ${slideClass} fmt-story paper-bg" id="slide-${idx + 1}" style="">
        
        <div class="grain-light"></div>
        <div class="tape-l c-ink"></div>
        <!-- Red stripe diagonal -->
        <div style="position:absolute; top:0; right:0; width:200px; height:100%; background:var(--fire); clip-path:polygon(40% 0, 100% 0, 100% 100%, 0 100%); z-index:2; opacity:1;"></div>
        <div class="cw" style="padding: 120px 260px 100px 96px; justify-content: center; gap: 0; position: relative; z-index: 10;">
          <div class="mtag ink" style="margin-bottom: 40px; font-size: 22px;">${s.tag || 'DESTAQUE'}</div>
          <div style="font-family: var(--fd); font-size: 110px; color: var(--ink); line-height: 0.88; letter-spacing: 2px; margin-bottom: 48px;">
      ${s.title}
    </div>
          <div style="width: 80px; height: 5px; background: var(--ink); margin-bottom: 48px;"></div>
          <div style="font-family: var(--fb); font-size: 40px; font-weight: 300; color: #444; line-height: 1.6; margin-bottom: 64px;">
      ${s.body}
    </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'story-e-price-oferta') {
      slidesHtml += `<div class="slide ${slideClass} fmt-story" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-gold"></div>
        <div class="tape-b c-gold"></div>
        <div class="cw" style="padding: 120px 88px 100px 96px; justify-content: center; gap: 0;">
          <div class="mtag gold" style="margin-bottom: 40px; font-size: 22px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-gold" style="margin-bottom: 48px;"></div>
          <div class="disp" style="font-size: 110px; margin-bottom: 48px; line-height: 0.88;">
      ${s.title}
    </div>
          
      ${s.body}
    
          <div class="btn-solid" style="text-align:center; font-size: 56px; padding: 40px 80px;">
            ATIVAR AGORA ↗
          </div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'banner-a-dark-split-cta') {
      slidesHtml += `<div class="slide ${slideClass} fmt-banner" id="slide-${idx + 1}" style="background: var(--void); display:flex;">
        
        <div class="grain"></div>
        <div class="tape-t c-fire"></div>
        <div class="tape-b c-fire"></div>
        <!-- Left: text block -->
        <div style="width:58%; height:100%; padding: 64px 72px 56px 80px; display:flex; flex-direction:column; justify-content:center; position:relative; z-index:30;">
          <div class="mtag" style="margin-bottom: 24px; font-size: 20px;">${s.tag || 'DESTAQUE'}</div>
          <div class="disp" style="font-size: 96px; line-height: 0.88; margin-bottom: 24px;">
      ${s.title}
    </div>
          <div class="body" style="font-size: 28px; max-width: 500px;">
      ${s.body}
    </div>
        </div>
        <!-- Right: stat block -->
        <div style="width:42%; height:100%; background:var(--fire); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; position:relative; z-index:30; clip-path: polygon(8% 0, 100% 0, 100% 100%, 0 100%);">
          <div class="grain" style="opacity:0.2;"></div>
          <div style="font-family: var(--fd); font-size: 160px; color: rgba(0,0,0,0.8); line-height: 0.8; position:relative; z-index:2;">165K</div>
          <div style="font-family: var(--fm); font-size: 22px; color: rgba(240,235,224,0.8); letter-spacing: 3px; text-transform: uppercase; position:relative; z-index:2;">EVENTOS RECUPERADOS</div>
          <div style="font-family: var(--fd); font-size: 44px; color: rgba(0,0,0,0.7); position:relative; z-index:2; margin-top:8px;">EM 30 DIAS</div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'banner-b-tech-lime-produto') {
      slidesHtml += `<div class="slide ${slideClass} fmt-banner" id="slide-${idx + 1}" style="background: var(--ts-bg); background-image: radial-gradient(rgba(184,233,43,0.1) 1px, transparent 0); background-size: 28px 28px;">
        
        <div class="tape-t c-lime"></div>
        <div class="tape-b c-lime"></div>
        <div style="position:absolute; inset:0; z-index:5; display:flex; flex-direction:row;">
          <!-- Left -->
          <div style="width:55%; padding: 56px 72px 56px 80px; display:flex; flex-direction:column; justify-content:center;">
            <div class="mtag lime" style="margin-bottom: 20px; font-size: 18px;">${s.tag || 'DESTAQUE'}</div>
            <div style="font-family: var(--fd); font-size: 88px; color: var(--bone); line-height: 0.88; letter-spacing: 2px; margin-bottom: 20px;">
      ${s.title}
    </div>
          </div>
          <!-- Right: features -->
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'banner-c-light-editorial-awareness') {
      slidesHtml += `<div class="slide ${slideClass} fmt-banner paper-bg" id="slide-${idx + 1}" style="position:relative;">
        
        <div class="grain-light"></div>
        <div style="position:absolute; top:0; right:0; width:48%; height:100%; background:var(--ink); z-index:2;"></div>
        <div style="position:absolute; top:0; right:48%; width:50px; height:100%; background:var(--fire); z-index:3; clip-path: polygon(0 0, 100% 0, 60% 100%, 0 100%);"></div>
        <!-- Left text -->
        <div style="position:absolute; left:0; top:0; width:50%; height:100%; padding: 52px 40px 52px 72px; display:flex; flex-direction:column; justify-content:center; z-index:10;">
          <div style="font-family: var(--fm); font-size: 14px; letter-spacing: 3px; color: #666; text-transform:uppercase; margin-bottom: 16px;">// MÉTODO</div>
          <div style="font-family: var(--fd); font-size: 80px; color: var(--ink); line-height: 0.88; letter-spacing: 2px;">
      ${s.title}
    </div>
        </div>
        <!-- Right text -->
        
      ${s.body}
    
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'banner-d-youtube-thumbnail-style') {
      slidesHtml += `<div class="slide ${slideClass} fmt-banner" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-t c-fire" style="height: 8px;"></div>
        <!-- Photo slot left -->
        <div style="position:absolute; left:0; top:0; bottom:0; width:44%; z-index:1;">
          <div style="width:100%; height:100%; background: linear-gradient(135deg, var(--iron), var(--steel)); display:flex; align-items:center; justify-content:center;">
            <div style="font-family: var(--fm); font-size: 14px; color: var(--steel); letter-spacing: 2px; text-transform: uppercase;">FOTO AQUI</div>
          </div>
          <div style="position:absolute; inset:0; background: linear-gradient(to right, transparent 60%, var(--carbon) 100%);"></div>
        </div>
        <!-- Text -->
        <div style="position:absolute; right:0; top:0; width:58%; height:100%; padding: 48px 64px 48px 40px; display:flex; flex-direction:column; justify-content:center; z-index:30;">
          <!-- Reaction emojis YT style -->
          
      ${s.body}
    
          <div class="disp" style="font-size: 80px; line-height: 0.88; margin-bottom: 20px;">
      ${s.title}
    </div>
          <div style="font-family: var(--fm); font-size: 16px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase;">Como resolvemos · Caso real</div>
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'midnight-capa-premium') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--mid-bg);">
        
        <div class="grain"></div>
        <!-- Purple glow -->
        <div class="glow-blob" style="width:900px; height:900px; background:var(--mid-acc); opacity:0.12; top:-300px; right:-300px;"></div>
        <div class="glow-blob" style="width:600px; height:600px; background:var(--mid-gold); opacity:0.06; bottom:-100px; left:-200px;"></div>
        <div class="tape-l" style="background: var(--mid-acc);"></div>
        <div class="tape-t" style="background: linear-gradient(to right, var(--mid-acc), var(--mid-gold));"></div>
        <div class="sn">${slideNo}</div>
        <!-- Inset frame -->
        <div style="position:absolute; inset:24px; border:1px solid rgba(108,92,231,0.2); z-index:5; pointer-events:none;"></div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: flex-end; gap: 0;">
          <div style="font-family: var(--fm); font-size: 18px; letter-spacing: 3px; color: var(--mid-acc); display:flex; align-items:center; gap:12px; margin-bottom: 40px;">
            <span style="color: rgba(108,92,231,0.4);">//</span> ELITE GROWTH
          </div>
          <div style="width: 64px; height: 3px; background: linear-gradient(to right, var(--mid-acc), var(--mid-gold)); margin-bottom: 40px;"></div>
          <div style="font-family: var(--fd); font-size: 108px; color: rgba(248,249,250,0.92); line-height: 0.88; letter-spacing: 2px; margin-bottom: 48px;">
      ${s.title}
    </div>

      ${s.body}
    </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'midnight-social-proof') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--mid-card);">
        
        <div class="grain"></div>
        <div class="glow-blob" style="width:700px; height:700px; background:var(--mid-acc); opacity:0.08; top:100px; left:-200px;"></div>
        <div class="tape-l" style="background: var(--mid-gold);"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div style="font-family: var(--fm); font-size: 18px; letter-spacing: 3px; color: var(--mid-gold); display:flex; align-items:center; gap:12px; margin-bottom: 32px;">
            <span style="color: rgba(212,175,55,0.4);">//</span> PROVA SOCIAL
          </div>
          <div style="width: 64px; height: 3px; background: var(--mid-gold); margin-bottom: 40px;"></div>
          <div style="font-family: var(--fd); font-size: 88px; color: rgba(248,249,250,0.92); line-height: 0.9; letter-spacing: 2px; margin-bottom: 56px;">
      ${s.title}
    </div>
          <!-- Social proof row midnight -->
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'midnight-tabela-compara-o') {
      slidesHtml += `<div class="slide ${slideClass} fmt-portrait" id="slide-${idx + 1}" style="background: var(--mid-bg);">
        
        <div class="grain"></div>
        <div class="tape-l" style="background: var(--mid-acc);"></div>
        <div class="sn">${slideNo}</div>
        <div class="cw" style="padding: 100px 88px 80px 96px; justify-content: center; gap: 0;">
          <div style="font-family: var(--fm); font-size: 18px; letter-spacing: 3px; color: var(--mid-acc); display:flex; align-items:center; gap:12px; margin-bottom: 32px;">
            <span style="color: rgba(108,92,231,0.4);">//</span> INFRAESTRUTURA
          </div>
          <div style="width: 64px; height: 3px; background: var(--mid-acc); margin-bottom: 40px;"></div>
          <div style="font-family: var(--fd); font-size: 88px; color: rgba(248,249,250,0.92); line-height: 0.9; letter-spacing: 2px; margin-bottom: 48px;">
      ${s.title}
    </div>
          
      ${s.body}
    
        </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'lead-form-dark') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square" id="slide-${idx + 1}" style="background: var(--void);">
        
        <div class="grain"></div>
        <div class="tape-l c-fire"></div>
        <div class="tape-b c-fire"></div>
        <div class="cw" style="padding: 80px 100px 80px 108px; justify-content: center; gap: 0;">
          <div class="mtag" style="margin-bottom: 28px;">${s.tag || 'DESTAQUE'}</div>
          <div class="hl hl-md c-fire" style="margin-bottom: 36px;"></div>
          <div class="disp" style="font-size: 96px; margin-bottom: 48px; line-height: 0.88;">
      ${s.title}
    </div>
          <div class="dark-form">
            <div class="form-field">
              <div class="form-label">Seu nome</div>
              <div class="form-input filled">João Gobira</div>
            </div>
            <div class="form-field">
              <div class="form-label">Budget mensal em ads</div>
              <div class="form-input">R\$ _______________</div>
            </div>
            <div class="form-field">
              <div class="form-label">Plataforma principal</div>
              <div class="form-input">Meta Ads / Google Ads</div>
            </div>
          </div>
          <div class="btn-solid" style="margin-top: 48px; text-align: center; font-size: 48px;">
            CALCULAR AGORA ↗
          </div>
        
      ${s.body}
    </div>
      
      </div>\n<div class="sep"></div>\n`;
    } else if (s.layout === 'social-proof-cta-direto') {
      slidesHtml += `<div class="slide ${slideClass} fmt-square" id="slide-${idx + 1}" style="background: var(--carbon);">
        
        <div class="grain"></div>
        <div class="tape-l c-gold"></div>
        <div class="tape-t c-gold"></div>
        <div class="cw" style="padding: 80px 100px 80px 108px; justify-content: space-between; gap: 0;">
          <div>
            <div class="mtag gold" style="margin-bottom: 28px;">${s.tag || 'DESTAQUE'}</div>
            <div class="disp" style="font-size: 76px; margin-bottom: 0; line-height: 0.9;">
      ${s.title}
    </div>
          </div>
          
      ${s.body}
    
          <div class="btn-outline" style="text-align: center; font-size: 44px; padding: 28px 64px; margin-top: 8px;">
            QUERO ESSE RESULTADO
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


  const brandColors = brandId === 'tgsr' ? `
  --void:   #0e1217;
  --carbon: #151b23;
  --iron:   #1e2631;
  --steel:  #2d3748;
  --fire:   #b8e92b;
  --gold:   #b8e92b;
  --bone:   #f8f9fa;
  --muted:  #718096;
  --text:   #e2e8f0;
  --sub:    #a0aec0;
  --ts-bg:  #0e1217;
  --ts-card:#151b23;
  --ts-edge:#1e2631;
  --ts-line:#2d3748;
  --ts-lime:#b8e92b;
  --mid-bg: #07060A;
  --mid-card:#0F0E14;
  --mid-acc:#6C5CE7;
  --mid-gold:#D4AF37;
  --paper:  #F7F3EC;
  --ink:    #111111;
  --cream:  #E8E2D6;` : `
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
  --ts-bg:  #0e1217;
  --ts-card:#151b23;
  --ts-edge:#1e2631;
  --ts-line:#2d3748;
  --ts-lime:#b8e92b;
  --mid-bg: #07060A;
  --mid-card:#0F0E14;
  --mid-acc:#6C5CE7;
  --mid-gold:#D4AF37;
  --paper:  #F7F3EC;
  --ink:    #111111;
  --cream:  #E8E2D6;`;

  const previewOverride = preview ? `<base href="http://localhost:${PORT}/${folder}/">
<style>
body{padding:0!important;margin:0!important;}
.preview-info{display:none!important;}
.slide,.yt-thumb,.ad-square,.ad-portrait,.ad-story,.banner,.logo-asset{transform:none!important;margin:0!important;border:none!important;}
.sep{display:none!important;}
</style>` : '';

  const fullHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@300;400;500&family=Space+Mono:wght@400;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

:root {${brandColors}
  --fd: 'Bebas Neue', sans-serif;
  --fc: 'Barlow Condensed', sans-serif;
  --fb: 'Barlow', sans-serif;
  --fm: 'Space Mono', monospace;
  --fi: 'Inter', sans-serif;
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

/* ── KPI ROW ─────────────────────────────────────────────────────────── */
.kpi-row { display:flex; align-items:stretch; justify-content:center; width:100%; border-top:1px solid var(--steel); border-bottom:1px solid var(--steel); }
.kpi-item { display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; gap:12px; padding:32px 16px; }
.kpi-val { font-family:var(--fd); font-size:88px; color:var(--bone); line-height:1; }
.kpi-val.fire { color:var(--fire); }
.kpi-val.gold { color:var(--gold); }
.kpi-lbl { font-family:var(--fm); font-size:14px; color:rgba(240,235,224,0.4); letter-spacing:2px; text-align:center; text-transform:uppercase; }
.kpi-sep { width:1px; background:var(--steel); align-self:stretch; flex-shrink:0; }

/* ── DONUT CHART ─────────────────────────────────────────────────────── */
.donut-wrap { display:flex; flex-direction:column; align-items:center; gap:28px; }
.donut { width:240px; height:240px; border-radius:50%; position:relative; flex-shrink:0; }
.donut-hole { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:152px; height:152px; background:var(--void); border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; }
.donut-val { font-family:var(--fd); font-size:60px; color:var(--bone); line-height:1; }
.donut-lbl { font-family:var(--fm); font-size:12px; color:var(--fire); letter-spacing:2px; text-transform:uppercase; }
.donut-legend { display:flex; gap:28px; }
.donut-item { display:flex; align-items:center; gap:10px; font-family:var(--fm); font-size:13px; color:rgba(240,235,224,0.55); letter-spacing:1px; }
.donut-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }

/* ── FUNNEL CHART ───────────────────────────────────────────────────── */
.funnel-chart { display:flex; flex-direction:column; align-items:center; gap:4px; width:100%; }
.funnel-stage { display:flex; justify-content:center; width:100%; }
.funnel-bar { display:flex; justify-content:space-between; align-items:center; height:60px; padding:0 28px; width:100%; }
.funnel-label { font-family:var(--fm); font-size:15px; letter-spacing:2px; color:rgba(240,235,224,0.65); text-transform:uppercase; }
.funnel-val { font-family:var(--fd); font-size:36px; color:var(--bone); }

/* ── TREND LINE ─────────────────────────────────────────────────────── */
.trend-wrap { display:flex; flex-direction:column; gap:14px; width:100%; }
.trend-label { font-family:var(--fm); font-size:13px; color:rgba(240,235,224,0.4); letter-spacing:2px; text-transform:uppercase; }
.trend-svg { width:100%; height:88px; overflow:visible; }
.trend-area { fill:none; }
.trend-vals { display:flex; justify-content:space-between; align-items:center; }
.trend-start { font-family:var(--fm); font-size:14px; color:rgba(240,235,224,0.35); }
.trend-end { font-family:var(--fd); font-size:36px; color:var(--fire); }
.trend-end::before { content:'↑ '; }

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

/* 10. Lista Brutalista (layout-split-list) */
.slide.layout-split-list, .ad-story.layout-split-list, .ad-portrait.layout-split-list {
  background: var(--void) !important;
  color: var(--bone) !important;
}
.slide.layout-split-list .cw, .ad-story.layout-split-list .cw, .ad-portrait.layout-split-list .cw {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  gap: 40px !important;
}
.slide.layout-split-list .split-container, .ad-story.layout-split-list .split-container, .ad-portrait.layout-split-list .split-container {
  display: flex !important;
  gap: 60px !important;
  width: 100% !important;
  border-top: 4px solid var(--fire) !important;
  padding-top: 40px !important;
}
.slide.layout-split-list .split-col, .ad-story.layout-split-list .split-col, .ad-portrait.layout-split-list .split-col {
  flex: 1 !important;
}
.slide.layout-split-list .split-title, .ad-story.layout-split-list .split-title, .ad-portrait.layout-split-list .split-title {
  font-family: var(--fc) !important;
  font-size: 32px !important;
  color: var(--bone) !important;
  margin-bottom: 24px !important;
  text-transform: uppercase !important;
  letter-spacing: 2px !important;
}
.slide.layout-split-list .split-col:last-child .split-title, .ad-story.layout-split-list .split-col:last-child .split-title, .ad-portrait.layout-split-list .split-col:last-child .split-title {
  color: var(--fire) !important;
}
.slide.layout-split-list .split-item, .ad-story.layout-split-list .split-item, .ad-portrait.layout-split-list .split-item {
  font-family: var(--fb) !important;
  font-size: 26px !important;
  color: var(--sub) !important;
  margin-bottom: 16px !important;
  line-height: 1.4 !important;
  padding-left: 20px !important;
  position: relative !important;
}
.slide.layout-split-list .split-item::before, .ad-story.layout-split-list .split-item::before, .ad-portrait.layout-split-list .split-item::before {
  content: "—" !important;
  position: absolute !important;
  left: 0 !important;
  color: var(--steel) !important;
}

/* 11. Centro Texturizado (layout-center-texture) */
.slide.layout-center-texture, .ad-square.layout-center-texture, .ad-story.layout-center-texture {
  background: radial-gradient(circle at center, #2a2a2a 0%, var(--void) 70%) !important;
  color: var(--bone) !important;
}
.slide.layout-center-texture .cw, .ad-square.layout-center-texture .cw, .ad-story.layout-center-texture .cw {
  align-items: center !important;
  text-align: center !important;
  justify-content: center !important;
}
.slide.layout-center-texture .mono-tag, .ad-square.layout-center-texture .mono-tag, .ad-story.layout-center-texture .mono-tag {
  justify-content: center !important;
}
.slide.layout-center-texture .disp-large, .slide.layout-center-texture .disp-medium,
.ad-square.layout-center-texture .disp-large, .ad-square.layout-center-texture .disp-medium,
.ad-story.layout-center-texture .disp-large, .ad-story.layout-center-texture .disp-medium {
  text-align: center !important;
}
.slide.layout-center-texture .h-line, .ad-square.layout-center-texture .h-line, .ad-story.layout-center-texture .h-line {
  margin-left: auto !important;
  margin-right: auto !important;
}

/* 12. Cartão Flutuante (layout-highlight-card) */
.slide.layout-highlight-card, .ad-square.layout-highlight-card, .ad-portrait.layout-highlight-card, .yt-thumb.layout-highlight-card {
  background: var(--carbon) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
.slide.layout-highlight-card .cw, .ad-square.layout-highlight-card .cw, .ad-portrait.layout-highlight-card .cw, .yt-thumb.layout-highlight-card .cw {
  background: var(--bone) !important;
  border: 4px solid var(--void) !important;
  box-shadow: 16px 16px 0px var(--void) !important;
  padding: 80px !important;
  width: 80% !important;
  height: auto !important;
  margin: auto !important;
  align-items: center !important;
  text-align: center !important;
}
.slide.layout-highlight-card .disp-large, .slide.layout-highlight-card .disp-medium,
.ad-square.layout-highlight-card .disp-large, .ad-square.layout-highlight-card .disp-medium,
.ad-portrait.layout-highlight-card .disp-large, .ad-portrait.layout-highlight-card .disp-medium,
.yt-thumb.layout-highlight-card .disp-large, .yt-thumb.layout-highlight-card .disp-medium {
  color: var(--void) !important;
  font-size: 80px !important;
  line-height: 1.0 !important;
}
.slide.layout-highlight-card .body-copy, .ad-square.layout-highlight-card .body-copy, .ad-portrait.layout-highlight-card .body-copy, .yt-thumb.layout-highlight-card .body-copy {
  color: var(--void) !important;
  font-weight: 500 !important;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.slide.layout-highlight-card .mono-tag, .ad-square.layout-highlight-card .mono-tag, .ad-portrait.layout-highlight-card .mono-tag, .yt-thumb.layout-highlight-card .mono-tag {
  color: var(--void) !important;
}
.slide.layout-highlight-card .h-line, .ad-square.layout-highlight-card .h-line, .ad-portrait.layout-highlight-card .h-line, .yt-thumb.layout-highlight-card .h-line {
  background: var(--fire) !important;
  margin: 0 auto 40px auto !important;
}

/* 13. Capa: Divisão Invertida (cover-split-reverse) */
.slide.layout-cover-split-reverse {
  background: var(--carbon) !important;
}
.slide.layout-cover-split-reverse .split-bg,
.slide.layout-cover-split-reverse .photo-bg {
  top: 0 !important; left: 0 !important; bottom: 0 !important; right: auto !important;
  width: 50% !important;
  border-right: 2px solid var(--steel) !important;
  border-left: none !important;
  background-position: center center !important;
}
.slide.layout-cover-split-reverse .split-gradient,
.slide.layout-cover-split-reverse .split-gradient-bottom,
.slide.layout-cover-split-reverse .photo-overlay {
  display: none !important;
}
.slide.layout-cover-split-reverse .cw {
  margin-left: 50% !important;
  width: 50% !important;
  justify-content: center !important;
  padding: 60px 80px !important;
}

/* 14. Capa: Vazio Absoluto (cover-minimal-void) */
.slide.layout-cover-minimal-void {
  background: var(--void) !important;
  color: var(--bone) !important;
}
.slide.layout-cover-minimal-void .photo-bg,
.slide.layout-cover-minimal-void .split-bg,
.slide.layout-cover-minimal-void .photo-overlay,
.slide.layout-cover-minimal-void .grain {
  display: none !important;
}
.slide.layout-cover-minimal-void .cw {
  justify-content: center !important;
  align-items: center !important;
  text-align: center !important;
}
.slide.layout-cover-minimal-void .disp-large {
  font-size: 160px !important;
  line-height: 0.8 !important;
  margin-bottom: 30px !important;
}
.slide.layout-cover-minimal-void .h-line {
  margin-left: auto !important;
  margin-right: auto !important;
}

/* 15. Capa: Peso Superior (cover-top-heavy) */
.slide.layout-cover-top-heavy {
  background: var(--carbon) !important;
}
.slide.layout-cover-top-heavy .split-bg,
.slide.layout-cover-top-heavy .photo-bg {
  top: 0 !important; left: 0 !important; right: 0 !important; bottom: auto !important;
  width: 100% !important; height: 50% !important;
  border-bottom: 4px solid var(--fire) !important;
  border-left: none !important;
}
.slide.layout-cover-top-heavy .split-gradient,
.slide.layout-cover-top-heavy .split-gradient-bottom,
.slide.layout-cover-top-heavy .photo-overlay {
  display: none !important;
}
.slide.layout-cover-top-heavy .cw {
  position: absolute !important;
  bottom: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 50% !important;
  justify-content: flex-start !important;
  padding: 60px 80px !important;
}

/* 16. Modern Glass Story (modern-glass-story) */
.slide.layout-modern-glass-story {
  background: radial-gradient(circle at top left, #2a2a2a, #000) !important;
}
.slide.layout-modern-glass-story .photo-bg {
  filter: blur(20px) saturate(1.5) !important;
  opacity: 0.6 !important;
}
.slide.layout-modern-glass-story .cw {
  background: rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: blur(40px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 32px !important;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
  margin: 40px !important;
  width: calc(100% - 80px) !important;
  height: auto !important;
  padding: 60px 40px !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
}
.slide.layout-modern-glass-story .disp-large {
  font-family: var(--fi) !important;
  font-weight: 700 !important;
  letter-spacing: -1px !important;
  text-transform: none !important;
}
.slide.layout-modern-glass-story .body-copy {
  font-family: var(--fi) !important;
  font-weight: 300 !important;
  color: rgba(255, 255, 255, 0.8) !important;
  border: none !important;
}

/* 17. Clean YouTube Thumb (clean-youtube-thumb) */
.slide.layout-clean-youtube-thumb {
  background: #FFFFFF !important;
  color: #111111 !important;
}
.slide.layout-clean-youtube-thumb .cw {
  align-items: flex-start !important;
  justify-content: center !important;
  padding: 80px 120px !important;
  width: 60% !important;
  z-index: 10 !important;
}
.slide.layout-clean-youtube-thumb .photo-bg {
  width: 50% !important;
  left: auto !important;
  right: 0 !important;
  filter: drop-shadow(-20px 0 40px rgba(0,0,0,0.1)) !important;
  border-left: none !important;
}
.slide.layout-clean-youtube-thumb .disp-large {
  font-family: var(--fi) !important;
  font-weight: 800 !important;
  font-size: 100px !important;
  line-height: 1.1 !important;
  letter-spacing: -3px !important;
  text-transform: none !important;
  color: #111111 !important;
  text-shadow: none !important;
}
.slide.layout-clean-youtube-thumb .h-line {
  background: #333333 !important;
  margin-bottom: 30px !important;
}

/* 18. Bento Modern Ad (bento-modern-ad) */
.slide.layout-bento-modern-ad {
  background: #F7F7F7 !important;
  color: #111111 !important;
  padding: 40px !important;
}
.slide.layout-bento-modern-ad .cw {
  background: #FFFFFF !important;
  border-radius: 24px !important;
  border: 1px solid rgba(0,0,0,0.05) !important;
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.05) !important;
  padding: 60px !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: space-between !important;
  height: 100% !important;
}
.slide.layout-bento-modern-ad .disp-large {
  font-family: var(--fi) !important;
  font-weight: 700 !important;
  font-size: 72px !important;
  letter-spacing: -2px !important;
  text-transform: none !important;
  color: #111111 !important;
}

/* 19. Mesh Banner Widescreen (mesh-banner-widescreen) */
.slide.layout-mesh-banner-widescreen {
  background: radial-gradient(at 0% 0%, hsla(253,16%,7%,1) 0, transparent 50%), 
              radial-gradient(at 50% 0%, hsla(225,39%,30%,1) 0, transparent 50%), 
              radial-gradient(at 100% 0%, hsla(339,49%,30%,1) 0, transparent 50%);
  background-color: #111111 !important;
  color: #FFFFFF !important;
}
.slide.layout-mesh-banner-widescreen .photo-bg { display: none !important; }
.slide.layout-mesh-banner-widescreen .cw {
  align-items: center !important;
  justify-content: center !important;
  text-align: center !important;
}
.slide.layout-mesh-banner-widescreen .disp-large {
  font-family: var(--fi) !important;
  font-weight: 500 !important;
  letter-spacing: -2px !important;
  font-size: 110px !important;
  text-transform: none !important;
  text-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
}
.slide.layout-mesh-banner-widescreen .h-line { display: none !important; }

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



/* ═══════════════════════════════════════════════════════
   COMPONENTES DA BIBLIOTECA DE TEMPLATES (novos layouts)
   ═══════════════════════════════════════════════════════ */

/* Tape bars laterais/horizontais */
.tape-l { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; z-index: 20; }
.tape-r { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; z-index: 20; }
.tape-t { position: absolute; top: 0; left: 0; right: 0; height: 5px; z-index: 20; }
.tape-b { position: absolute; bottom: 0; left: 0; right: 0; height: 5px; z-index: 20; }
.c-fire { background: var(--fire); }
.c-gold { background: var(--gold); }
.c-lime { background: #b8e92b; }
.c-bone { background: rgba(240,235,224,0.4); }
.c-ink  { background: #111111; }

/* Número de slide curto */
.sn { position: absolute; top: 64px; right: 72px; font-family: var(--fm); font-size: 20px; color: var(--steel); letter-spacing: 2px; z-index: 40; }

/* Mono tag (.mtag) */
.mtag { font-family: var(--fm); font-size: 18px; letter-spacing: 3px; text-transform: uppercase; color: var(--fire); display: flex; align-items: center; gap: 12px; }
.mtag::before { content: '//'; color: var(--steel); }
.mtag.lg { font-size: 24px; }
.mtag.gold { color: var(--gold); }
.mtag.lime { color: #b8e92b; }
.mtag.bone { color: rgba(240,235,224,0.6); }
.mtag.ink  { color: #111111; }
.mtag.ink::before { color: #888888; }

/* Linhas de acento (.hl) */
.hl { height: 4px; }
.hl-sm { width: 48px; }
.hl-md { width: 80px; }
.hl-full { width: 100%; }

/* Display type curto (.disp) */
.disp { font-family: var(--fd); letter-spacing: 2px; color: var(--bone); line-height: 0.9; }
.disp em { font-style: normal; color: var(--fire); }
.disp .gold { color: var(--gold); }
.disp .lime { color: #b8e92b; }
.disp .ink  { color: #111111; }

/* Body copy curto (.body) */
.body { font-family: var(--fb); font-weight: 300; color: var(--sub); line-height: 1.55; }
.body strong { color: var(--text); font-weight: 500; }
.body em { font-style: normal; color: var(--fire); }

/* Paper background */
.paper-bg { background: #F7F3EC !important; }

/* Paper grain */
.grain-light { position: absolute; inset: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E"); pointer-events: none; z-index: 50; opacity: 0.4; mix-blend-mode: multiply; }

/* Glow blob */
.glow-blob { position: absolute; border-radius: 50%; pointer-events: none; z-index: 2; filter: blur(180px); }

/* Inset frame */
.inset-frame { position: absolute; inset: 24px; border: 1px solid rgba(255,255,255,0.06); z-index: 25; pointer-events: none; }

/* Dividers */
.div-line { width: 100%; border: none; border-top: 2px solid var(--iron); }
.div-dashed { width: 100%; border: none; border-top: 2px dashed var(--steel); }

/* Author badge */
.badge { display: flex; align-items: center; gap: 24px; padding: 20px 36px 20px 20px; background: rgba(26,26,26,0.9); border: 2px solid var(--steel); width: fit-content; }
.badge-av { width: 80px; height: 80px; border-radius: 50%; border: 3px solid var(--fire); object-fit: cover; background: var(--steel); flex-shrink: 0; }
.badge-name { font-family: var(--fd); font-size: 34px; color: var(--bone); letter-spacing: 1px; }
.badge-role { font-family: var(--fm); font-size: 13px; color: var(--fire); letter-spacing: 2px; text-transform: uppercase; margin-top: 4px; }

/* Bento Grid */
.bento { display: grid; gap: 16px; }
.bento-2x2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.bento-cell { background: var(--iron); padding: 36px 40px; display: flex; flex-direction: column; justify-content: flex-end; }
.bento-big { grid-column: span 2; }
.bento-n { font-family: var(--fd); font-size: 96px; color: var(--fire); line-height: 0.85; }
.bento-n.gold { color: var(--gold); }
.bento-n.lime { color: #b8e92b; }
.bento-lbl { font-family: var(--fm); font-size: 18px; color: var(--sub); letter-spacing: 2px; margin-top: 8px; text-transform: uppercase; }

/* Numbered List */
.num-list { display: flex; flex-direction: column; gap: 0; }
.num-item { display: flex; align-items: flex-start; gap: 32px; padding: 36px 0; border-bottom: 1px solid var(--iron); }
.num-item:last-child { border-bottom: none; }
.num-n { font-family: var(--fd); font-size: 72px; color: var(--steel); line-height: 0.85; min-width: 80px; }
.num-n.fire { color: var(--fire); }
.num-body { flex: 1; }
.num-title { font-family: var(--fc); font-size: 42px; font-weight: 800; color: var(--bone); letter-spacing: 1px; margin-bottom: 8px; }
.num-sub { font-family: var(--fb); font-size: 28px; font-weight: 300; color: var(--sub); line-height: 1.5; }

/* Score / Progress Bars */
.score-bar-wrap { width: 100%; display: flex; flex-direction: column; gap: 28px; }
.score-row { display: flex; flex-direction: column; gap: 10px; }
.score-label-row { display: flex; justify-content: space-between; }
.score-lbl { font-family: var(--fm); font-size: 18px; color: var(--sub); letter-spacing: 2px; text-transform: uppercase; }
.score-val { font-family: var(--fd); font-size: 28px; color: var(--bone); letter-spacing: 1px; }
.score-track { width: 100%; height: 8px; background: var(--iron); position: relative; }
.score-fill { height: 100%; }
.score-fill.fire { background: var(--fire); }
.score-fill.gold { background: var(--gold); }
.score-fill.lime { background: #b8e92b; }

/* Testimonial Stack */
.testimonial-card { background: var(--iron); border: 1px solid var(--steel); padding: 48px 56px; }
.testimonial-stars { display: flex; gap: 8px; margin-bottom: 24px; }
.star { width: 28px; height: 28px; background: var(--gold); clip-path: polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%); }
.testimonial-text { font-family: var(--fb); font-size: 34px; font-weight: 300; color: var(--text); line-height: 1.6; margin-bottom: 32px; }
.testimonial-author { font-family: var(--fm); font-size: 16px; color: var(--fire); letter-spacing: 2px; text-transform: uppercase; }
.testimonial-company { font-family: var(--fm); font-size: 14px; color: var(--muted); letter-spacing: 2px; margin-top: 4px; }

/* Checklist */
.checklist { display: flex; flex-direction: column; gap: 0; }
.check-item { display: flex; align-items: center; gap: 32px; padding: 28px 0; border-bottom: 1px solid var(--iron); }
.check-icon { width: 44px; height: 44px; border: 2px solid var(--fire); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.check-icon.checked { background: var(--fire); }
.check-icon svg { width: 22px; height: 22px; }
.check-text { font-family: var(--fb); font-size: 34px; font-weight: 300; color: var(--text); }
.check-text.done { color: var(--sub); text-decoration: line-through; }

/* Timeline */
.timeline { display: flex; flex-direction: column; }
.tl-item { display: flex; gap: 48px; position: relative; padding-bottom: 48px; }
.tl-item:last-child { padding-bottom: 0; }
.tl-left { display: flex; flex-direction: column; align-items: center; }
.tl-dot { width: 20px; height: 20px; border-radius: 50%; background: var(--fire); flex-shrink: 0; }
.tl-line { flex: 1; width: 2px; background: var(--steel); margin-top: 8px; }
.tl-year { font-family: var(--fd); font-size: 36px; color: var(--fire); white-space: nowrap; margin-top: 2px; }
.tl-body { padding-top: 2px; }
.tl-title { font-family: var(--fc); font-size: 44px; font-weight: 800; color: var(--bone); letter-spacing: 1px; }
.tl-desc { font-family: var(--fb); font-size: 28px; font-weight: 300; color: var(--sub); line-height: 1.5; margin-top: 8px; }

/* Dark Quote Pull */
.quote-big { position: relative; padding: 60px 80px; border-left: 8px solid var(--fire); }
.quote-bg-mark { position: absolute; top: -40px; left: 40px; font-family: var(--fd); font-size: 400px; color: var(--fire); opacity: 0.06; line-height: 1; pointer-events: none; z-index: 1; }

/* Icon Grid 2×2 */
.icon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.icon-cell { background: var(--iron); padding: 48px 48px 40px; display: flex; flex-direction: column; gap: 20px; }
.icon-sym { font-size: 64px; line-height: 1; }
.icon-title { font-family: var(--fc); font-size: 38px; font-weight: 800; color: var(--bone); letter-spacing: 1px; }
.icon-desc { font-family: var(--fb); font-size: 26px; font-weight: 300; color: var(--sub); line-height: 1.4; }

/* Social Proof Row */
.sp-row { display: flex; gap: 48px; padding: 40px 0; border-top: 2px solid var(--iron); border-bottom: 2px solid var(--iron); }
.sp-item { text-align: center; flex: 1; }
.sp-num { font-family: var(--fd); font-size: 80px; color: var(--fire); line-height: 0.85; }
.sp-num.gold { color: var(--gold); }
.sp-lbl { font-family: var(--fm); font-size: 15px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; margin-top: 8px; }

/* Price / Offer Block */
.price-block { background: var(--iron); border: 2px solid var(--fire); padding: 48px 56px; display: flex; flex-direction: column; gap: 16px; }
.price-from { font-family: var(--fm); font-size: 18px; color: var(--muted); letter-spacing: 2px; text-decoration: line-through; }
.price-main { font-family: var(--fd); font-size: 120px; color: var(--bone); line-height: 0.85; }
.price-period { font-family: var(--fm); font-size: 22px; color: var(--sub); letter-spacing: 2px; }
.price-features { display: flex; flex-direction: column; gap: 16px; margin-top: 16px; border-top: 1px solid var(--steel); padding-top: 24px; }
.price-feat { font-family: var(--fb); font-size: 28px; font-weight: 400; color: var(--text); display: flex; gap: 16px; align-items: center; }
.price-feat::before { content: '✓'; color: var(--fire); font-weight: 700; }

/* CTA Buttons */
.btn-solid { display: inline-block; padding: 36px 80px; background: var(--fire); color: var(--bone); font-family: var(--fd); font-size: 52px; letter-spacing: 3px; text-transform: uppercase; }
.btn-outline { display: inline-block; padding: 34px 80px; border: 3px solid var(--fire); color: var(--fire); font-family: var(--fd); font-size: 52px; letter-spacing: 3px; text-transform: uppercase; }
.btn-ghost { display: inline-block; padding: 34px 80px; border: 3px solid rgba(240,235,224,0.3); color: var(--bone); font-family: var(--fd); font-size: 52px; letter-spacing: 3px; text-transform: uppercase; }

/* Dark Form */
.dark-form { display: flex; flex-direction: column; gap: 20px; }
.form-field { border-bottom: 2px solid var(--steel); padding-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
.form-label { font-family: var(--fm); font-size: 16px; color: var(--muted); letter-spacing: 3px; text-transform: uppercase; }
.form-input { font-family: var(--fb); font-size: 36px; font-weight: 300; color: var(--text); }
.form-input.filled { color: var(--bone); }

/* Code Block */
.code-block { background: #1e2631; border: 1px solid #2d3748; padding: 32px 40px; font-family: var(--fm); font-size: 26px; color: #b8e92b; line-height: 1.7; }
.code-block .cm { color: var(--muted); }
.code-block .ck { color: #7dd3fc; }
.code-block .cv { color: #f9a8d4; }
.code-block .cs { color: #b8e92b; }

/* Comparison Table */
.comp-table { width: 100%; border-collapse: collapse; }
.comp-table th { font-family: var(--fc); font-size: 26px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 24px 32px; text-align: left; border-bottom: 3px solid var(--iron); color: var(--sub); }
.comp-table td { font-family: var(--fb); font-size: 26px; font-weight: 300; padding: 22px 32px; color: var(--sub); border-bottom: 1px solid var(--iron); }
.comp-table .yes { color: var(--fire); font-weight: 600; }
.comp-table .no  { color: var(--steel); }
.comp-table tr.highlight td { background: rgba(200,57,26,0.06); }

@media print {
  @page { size: ${width}px ${height}px; margin: 0; }
  body { background: var(--void) !important; padding: 0 !important; display: block !important; }
  .slide { transform: none !important; margin: 0 !important; page-break-after: always; break-after: page; border: none !important; }
  .slide:last-of-type { page-break-after: auto; break-after: auto; }
}
</style>
${previewOverride}
</head>
<body>

<div class="preview-info">Carrossel Criador IA — ${name}</div>
${slidesHtml}
</body>
</html>`;

  if (preview) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(fullHtml);
  }
  fs.writeFileSync(targetPath, fullHtml, 'utf8');
  res.json({ ok: true, filename, fullPath: targetPath, relativePath: `${folder}/${filename}` });
});

// ── Serve o Studio HTML na raiz ───────────────────────────────────────────
function serveStudio(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(BASE_DIR, 'studio.html'));
}

app.get('/', serveStudio);
app.get('/studio.html', serveStudio);

// ── Rotas amigáveis do Blog ───────────────────────────────────────────────
app.get('/blog/:slug', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'blog', 'post.html'));
});

// ── Newsletter / Lead Capture ─────────────────────────────────────────────
app.post('/api/newsletter', (req, res) => {
  const { name, email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  const logLine = `[${new Date().toISOString()}] ${name || 'anon'} <${email}>`;
  try {
    fs.appendFileSync(path.join(BASE_DIR, 'newsletter-leads.txt'), logLine + '\n', 'utf8');
    console.log('  ✉ Novo lead:', logLine);
    res.json({ ok: true, message: 'Inscrição registrada!' });
  } catch (err) {
    console.error('Erro ao salvar lead:', err);
    res.status(500).json({ error: 'Erro ao registrar inscrição' });
  }
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
