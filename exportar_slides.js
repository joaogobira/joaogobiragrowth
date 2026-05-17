const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function exportarCarrossel(htmlFile, browser) {
  const page = await browser.newPage();

  const fullPath = path.resolve(htmlFile).replace(/\\/g, '/');
  await page.goto(`file:///${fullPath}`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);

  // Remove transform scales so slides render at native 1080px resolution
  await page.evaluate(() => {
    document.querySelectorAll('.slide').forEach(el => {
      el.style.transform = 'none';
      el.style.marginBottom = '0';
    });
    document.body.style.gap = '20px';
    document.body.style.padding = '0';
  });

  // Set viewport wide enough to contain full 1080px slide
  await page.setViewport({ width: 1200, height: 1200, deviceScaleFactor: 1 });

  const slides = await page.$$('.slide');

  if (slides.length === 0) {
    console.log(`  Nenhum slide encontrado.`);
    await page.close();
    return 0;
  }

  const dir = path.dirname(path.resolve(htmlFile));
  const baseName = path.basename(htmlFile, '.html');
  const outputDir = path.join(dir, baseName + '_slides');
  fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < slides.length; i++) {
    const outputPath = path.join(outputDir, `slide_${String(i + 1).padStart(2, '0')}.png`);
    await slides[i].screenshot({ path: outputPath });
    console.log(`  ✓ slide_${String(i + 1).padStart(2, '0')}.png`);
  }

  await page.close();
  return slides.length;
}

async function main() {
  const baseDir = __dirname;
  const carrosseisDirs = [
    path.join(baseDir, 'Carrosseis', 'LinkedIn'),
    path.join(baseDir, 'Carrosseis', 'Instagram'),
  ];

  const htmlFiles = [];
  for (const dir of carrosseisDirs) {
    if (!fs.existsSync(dir)) continue;
    fs.readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .forEach(f => htmlFiles.push(path.join(dir, f)));
  }

  if (htmlFiles.length === 0) {
    console.log('Nenhum arquivo HTML encontrado em Carrosseis/');
    return;
  }

  console.log(`Encontrados ${htmlFiles.length} carrosseis:\n`);
  htmlFiles.forEach(f => console.log(`  - ${path.relative(baseDir, f)}`));
  console.log('');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  let total = 0;
  try {
    for (const file of htmlFiles) {
      console.log(`Exportando: ${path.relative(baseDir, file)}`);
      const count = await exportarCarrossel(file, browser);
      console.log(`  → ${count} slides exportados\n`);
      total += count;
    }
  } finally {
    await browser.close();
  }

  console.log(`Concluído! ${total} slides exportados no total.`);
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
