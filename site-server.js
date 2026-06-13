/**
 * Site Server — João Gobira Growth
 * Servidor local para o site pessoal e blog.
 * Porta: 3000
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const BASE_DIR = __dirname;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Newsletter ──
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

// ── Arquivos estáticos ──
app.use(express.static(BASE_DIR, { index: false }));
app.use('/blog', express.static(path.join(BASE_DIR, 'blog')));
app.use('/posts', express.static(path.join(BASE_DIR, 'posts')));

// ── Rotas amigáveis do Blog ──
app.get('/blog/:slug', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'blog', 'post.html'));
});

// ── Fallback para SPA ──
app.get('*', (req, res) => {
  res.sendFile(path.join(BASE_DIR, '404.html'));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   🌐  Site Pessoal — JG              ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║   http://localhost:${PORT}               ║`);
  console.log('  ║   http://localhost:' + PORT + '/blog/     ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
