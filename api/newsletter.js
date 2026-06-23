/**
 * API de Newsletter — Serverless Function (Vercel)
 * Endpoint: POST /api/newsletter
 */

const fs = require('fs');
const path = require('path');

module.exports = async function handler(req, res) {
  // Apenas aceita POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { name, email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: 'Email obrigatório' });
  }

  const logLine = `[${new Date().toISOString()}] ${name || 'anon'} <${email}>`;
  console.log('✉ Novo lead:', logLine);

  // Na Vercel, o sistema de arquivos é read-only em produção.
  // Os leads são logados no console (visível no painel da Vercel > Functions > Logs).
  // Para persistir os dados, conecte um banco/planilha futuramente.

  return res.status(200).json({ ok: true, message: 'Inscrição registrada!' });
};
