const axios = require('axios');
const fs = require('fs');
const path = require('path');

const readConfig = () => {
  const cfgPath = path.join(__dirname, 'studio.config');
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

async function test() {
  const cfg = readConfig();
  const apiKey = cfg.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Nenhuma GEMINI_API_KEY encontrada em studio.config');
    return;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await axios.get(url);
    console.log('--- Modelos Disponíveis ---');
    const models = response.data.models.map(m => m.name);
    console.log(models);
    fs.writeFileSync(path.join(__dirname, 'models-list.json'), JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('Erro ao listar modelos:', err.response?.data?.error?.message || err.message);
  }
}

test();
