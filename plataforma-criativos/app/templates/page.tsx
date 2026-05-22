import { LAYOUTS } from '@/lib/templates';
import { FORMATOS } from '@/lib/design-system';

export default function TemplatesPage() {
  return (
    <div className="flex flex-col gap-8 pt-4">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Biblioteca de Templates</h1>
          <p className="text-neutral-400">
            Conheça todos os {Object.keys(LAYOUTS).length} layouts estruturais disponíveis para a IA usar.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.values(LAYOUTS).map((layout) => (
          <div key={layout.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 flex flex-col gap-4 hover:border-neutral-700 transition-colors">
            <div className="flex justify-between items-start">
              <h3 className="font-bold text-lg text-white leading-tight">{layout.label}</h3>
              <span className="text-xs font-mono bg-neutral-800 text-neutral-400 px-2 py-1 rounded">
                {layout.id}
              </span>
            </div>
            
            <p className="text-sm text-neutral-400 leading-relaxed flex-1">
              {layout.descricao}
            </p>
            
            <div className="flex flex-wrap gap-2 mt-2">
              {layout.formatos_suportados.map(f => (
                <span key={f} className="text-xs bg-[#C8391A]/10 text-[#C8391A] px-2 py-1 rounded font-medium">
                  {FORMATOS[f]?.label || f}
                </span>
              ))}
            </div>
            
            <div className="border-t border-neutral-800 pt-4 mt-2">
              <p className="text-xs text-neutral-500 font-mono mb-2">Componentes suportados:</p>
              <div className="flex flex-wrap gap-1">
                {layout.componentes.map(comp => (
                  <span key={comp} className="text-[10px] bg-neutral-950 border border-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">
                    {comp}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
