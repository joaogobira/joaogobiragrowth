import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT_CRIATIVO } from '@/lib/prompts/sistema';
import { FORMATOS, TEMAS } from '@/lib/design-system';
import { LAYOUTS } from '@/lib/templates/index';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      topico,           // string: "Jiu-jitsu e liderança"
      formato_id,       // 'portrait' | 'square' | 'story' | 'landscape' | 'banner'
      tema_id,          // 'dark_brutalista' | 'light_editorial' | ...
      num_slides,       // 3-10
      layouts,          // string[]: ['capa_split_vertical', 'numbered_list_dark', 'cta_simples']
      foto_url,         // URL da foto do usuário
      autor_nome,       // "João Gobira"
      autor_role,       // "// Growth · Gestão"
      dados_extras,     // objeto livre com dados específicos (ex: stats, keywords)
      tom,              // 'autoritário' | 'inspirador' | 'educativo' | 'urgência'
    } = body;

    const formato = FORMATOS[formato_id as keyof typeof FORMATOS];
    const tema = TEMAS[tema_id as keyof typeof TEMAS];

    const prompt = \`
Crie um carrossel de \${num_slides} slides sobre: "\${topico}"

CONFIGURAÇÕES:
- Formato: \${formato.label} (\${formato.width}×\${formato.height}px)
- Tema: \${tema.label}
- Tom: \${tom}
- Layouts a usar em ordem: \${layouts.join(', ')}
- Foto do usuário: \${foto_url}
- Autor: \${autor_nome} | \${autor_role}
\${dados_extras ? \`- Dados específicos: \${JSON.stringify(dados_extras)}\` : ''}

GERE:
\${layouts.map((layout_id: string, i: number) => {
  const layout = LAYOUTS[layout_id];
  return \`Slide \${i + 1} (\${i + 1}/\${num_slides}): Layout "\${layout?.label}" — \${layout?.descricao}\`;
}).join('\\n')}

Substitua {{FOTO_URL}} por: \${foto_url}
Substitua {{NOME_AUTOR}} por: \${autor_nome}
Substitua {{ROLE_AUTOR}} por: \${autor_role}

Retorne APENAS o HTML dos slides, sem nenhum texto fora do HTML.
\`;

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022', // Updated to available 3.5 sonnet
      max_tokens: 8000,
      system: SYSTEM_PROMPT_CRIATIVO,
      messages: [{ role: 'user', content: prompt }],
    });

    const html_gerado = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as any).text)
      .join('');

    // Inject CSS base + Google Fonts
    const html_completo = \`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --void:#080808; --carbon:#101010; --iron:#1A1A1A; --steel:#272727; --edge:#333;
    --fire:#C8391A; --ember:#E04B27; --gold:#B8922A; --amber:#D4A827; --lime:#8FBF26;
    --bone:#F0EBE0; --cream:#E8E2D6; --text:#EDE8E0; --sub:#9A9490; --muted:#5A5652;
    --paper:#F2EDE4; --paper2:#E8E2D6; --ink:#111111; --ink2:#222222;
    --ts-bg:#0e1217; --ts-lime:#b8e92b; --mid-bg:#07060A; --mid-acc:#6C5CE7; --mid-gold:#D4AF37;
    --fd:'Bebas Neue',sans-serif; --fc:'Barlow Condensed',sans-serif;
    --fb:'Barlow',sans-serif; --fm:'Space Mono',monospace;
  }
  *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; -webkit-print-color-adjust:exact!important; print-color-adjust:exact!important; }
  body { background:#111; display:flex; flex-direction:column; align-items:center; padding:48px 24px; }
  .slide { width:\${formato.width}px; height:\${formato.height}px; position:relative; overflow:hidden;
    flex-shrink:0; transform:scale(\${formato.scale}); transform-origin:top center;
    margin-bottom:calc(\${formato.height}px * \${formato.scale} - \${formato.height}px); }
  .sep { width:411px; height:2px; background:#222; margin:0 auto; }
</style>
</head>
<body>
\${html_gerado}
</body>
</html>\`;

    return Response.json({
      html: html_completo,
      slides_count: num_slides,
      formato: formato_id,
      tema: tema_id,
    });
  } catch (error) {
    console.error('Error generating creative:', error);
    return Response.json({ error: 'Erro ao gerar o criativo' }, { status: 500 });
  }
}
