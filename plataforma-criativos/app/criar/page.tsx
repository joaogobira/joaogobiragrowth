'use client';

import { useState } from 'react';
import { FORMATOS, TEMAS } from '@/lib/design-system';
import { LAYOUTS } from '@/lib/templates';
import SlidePreview from '@/components/editor/SlidePreview';

export default function CriarPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [htmlResult, setHtmlResult] = useState('');
  
  // Form state
  const [formato, setFormato] = useState('portrait');
  const [tema, setTema] = useState('dark_brutalista');
  const [topico, setTopico] = useState('');
  const [tom, setTom] = useState('autoritário');
  const [numSlides, setNumSlides] = useState(5);
  const [fotoUrl, setFotoUrl] = useState('/fotos/IMG_7386.JPG');
  const [autorNome, setAutorNome] = useState('João Gobira');
  const [autorRole, setAutorRole] = useState('// Growth · Gestão');

  const selectedFormat = FORMATOS[formato as keyof typeof FORMATOS];

  const handleGenerate = async () => {
    setLoading(true);
    try {
      // Por padrão, deixaremos a IA escolher os layouts baseados no número de slides
      // Ou podemos mandar alguns layouts base pra guiar
      const randomLayouts = Array.from({length: numSlides}).map((_, i) => {
        if (i === 0) return 'capa_split_vertical';
        if (i === numSlides - 1) return 'cta_simples';
        return 'foto_half_top';
      });

      const response = await fetch('/api/gerar-criativo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topico,
          formato_id: formato,
          tema_id: tema,
          num_slides: numSlides,
          layouts: randomLayouts,
          foto_url: fotoUrl,
          autor_nome: autorNome,
          autor_role: autorRole,
          tom,
        }),
      });
      
      const data = await response.json();
      if (data.html) {
        setHtmlResult(data.html);
        setStep(4);
      } else {
        alert(data.error || 'Erro desconhecido');
      }
    } catch (err) {
      console.error(err);
      alert('Falha na comunicação com a API.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-24">
      {/* Stepper Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-6">
        {[
          { num: 1, label: 'Formato' },
          { num: 2, label: 'Tema' },
          { num: 3, label: 'Conteúdo' },
          { num: 4, label: 'Preview' },
        ].map((s) => (
          <div key={s.num} className="flex items-center gap-3">
            <div className={\`w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold transition-colors \${step >= s.num ? 'bg-[#C8391A] text-white' : 'bg-neutral-800 text-neutral-500'}\`}>
              {s.num}
            </div>
            <span className={\`text-sm font-medium hidden md:block \${step >= s.num ? 'text-white' : 'text-neutral-500'}\`}>
              {s.label}
            </span>
            {s.num < 4 && <div className="w-8 md:w-16 h-px bg-neutral-800 ml-3 hidden sm:block"></div>}
          </div>
        ))}
      </div>

      {/* Step 1: Formato */}
      {step === 1 && (
        <div className="flex flex-col gap-6 animate-in fade-in">
          <h2 className="text-2xl font-bold">1. Escolha o Formato</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(FORMATOS).map(([key, val]) => (
              <div 
                key={key}
                onClick={() => setFormato(key)}
                className={\`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center gap-4 transition-all \${formato === key ? 'border-[#C8391A] bg-neutral-900' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-700'}\`}
              >
                <div className="w-16 h-16 border-2 border-neutral-700 rounded flex items-center justify-center text-xs text-neutral-500">
                  {val.width}x{val.height}
                </div>
                <div className="text-center font-medium">{val.label}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-8">
            <button onClick={() => setStep(2)} className="px-6 py-2 bg-white text-black font-bold rounded hover:bg-neutral-200">Próximo</button>
          </div>
        </div>
      )}

      {/* Step 2: Tema */}
      {step === 2 && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4">
          <h2 className="text-2xl font-bold">2. Escolha o Tema Visual</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(TEMAS).map(([key, val]) => (
              <div 
                key={key}
                onClick={() => setTema(key)}
                className={\`cursor-pointer border-2 rounded-xl p-4 flex flex-col gap-4 transition-all \${tema === key ? 'border-[#C8391A] bg-neutral-900' : 'border-neutral-800 bg-neutral-950 hover:border-neutral-700'}\`}
              >
                <div className="flex gap-2 h-12 rounded overflow-hidden">
                  {/* Colors preview */}
                  <div className="flex-1" style={{background: val.bg.includes('var') ? '#080808' : val.bg}}></div>
                  <div className="w-1/4" style={{background: val.accent.includes('var') ? '#C8391A' : val.accent}}></div>
                  <div className="w-1/4" style={{background: val.text.includes('var') ? '#F0EBE0' : val.text}}></div>
                </div>
                <div className="text-center font-medium">{val.label}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(1)} className="px-6 py-2 text-neutral-400 font-medium hover:text-white">Voltar</button>
            <button onClick={() => setStep(3)} className="px-6 py-2 bg-white text-black font-bold rounded hover:bg-neutral-200">Próximo</button>
          </div>
        </div>
      )}

      {/* Step 3: Conteúdo */}
      {step === 3 && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4">
          <h2 className="text-2xl font-bold">3. Defina o Conteúdo</h2>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-bold text-neutral-400">Tópico Principal (O que você quer ensinar/vender?)</label>
            <textarea 
              value={topico}
              onChange={(e) => setTopico(e.target.value)}
              className="w-full h-32 bg-neutral-900 border border-neutral-800 rounded p-4 text-white focus:border-[#C8391A] focus:outline-none"
              placeholder="Ex: Como construir uma cultura de vendas forte..."
            ></textarea>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-neutral-400">Tom de Voz</label>
              <select value={tom} onChange={(e) => setTom(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded p-3 text-white focus:border-[#C8391A] focus:outline-none">
                <option value="autoritário">Autoritário / Direto</option>
                <option value="inspirador">Inspirador / Motivacional</option>
                <option value="educativo">Educativo / Técnico</option>
                <option value="urgência">Urgência / Oferta</option>
              </select>
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-neutral-400">Número de Slides: {numSlides}</label>
              <input type="range" min="1" max="10" value={numSlides} onChange={(e) => setNumSlides(parseInt(e.target.value))} className="w-full mt-2 accent-[#C8391A]" />
            </div>
          </div>

          <div className="border-t border-neutral-800 pt-6 mt-2 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-neutral-400">URL da Foto</label>
              <input type="text" value={fotoUrl} onChange={(e) => setFotoUrl(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded p-3 text-white text-sm" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-neutral-400">Nome do Autor</label>
              <input type="text" value={autorNome} onChange={(e) => setAutorNome(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded p-3 text-white text-sm" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-bold text-neutral-400">Cargo / Role</label>
              <input type="text" value={autorRole} onChange={(e) => setAutorRole(e.target.value)} className="w-full bg-neutral-900 border border-neutral-800 rounded p-3 text-white text-sm" />
            </div>
          </div>

          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(2)} className="px-6 py-2 text-neutral-400 font-medium hover:text-white" disabled={loading}>Voltar</button>
            <button 
              onClick={handleGenerate} 
              disabled={loading || !topico}
              className="px-6 py-2 bg-[#C8391A] text-white font-bold rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 shadow-[0_0_15px_rgba(200,57,26,0.5)]"
            >
              {loading ? 'Gerando com Claude...' : 'Gerar Criativo Magicamente'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && (
        <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">4. Resultado Final</h2>
            <button onClick={() => setStep(3)} className="text-neutral-400 hover:text-white text-sm font-medium underline">Editar Conteúdo</button>
          </div>
          
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-8 flex flex-col items-center overflow-x-auto">
            {htmlResult ? (
              <SlidePreview 
                htmlContent={htmlResult} 
                width={selectedFormat.width} 
                height={selectedFormat.height} 
                scale={selectedFormat.scale} 
              />
            ) : (
              <div className="text-neutral-500 py-20">Nenhum HTML gerado.</div>
            )}
          </div>
          
          <div className="flex justify-center">
            <button onClick={() => {setStep(1); setHtmlResult('');}} className="px-6 py-3 border border-neutral-700 text-neutral-300 font-medium rounded hover:bg-neutral-800">
              Criar Novo
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
