import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col gap-12 pt-8">
      <section className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-neutral-900 p-8 rounded-xl border border-neutral-800">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold text-white mb-4">Bem-vindo à Máquina de Criativos</h1>
          <p className="text-neutral-400">
            Crie carrosséis, stories e banners de alta conversão em segundos utilizando a inteligência do Claude e o design system Brutalista Escuro.
          </p>
        </div>
        <Link href="/criar" className="whitespace-nowrap px-6 py-3 bg-[#C8391A] text-white font-bold rounded-lg hover:bg-red-700 transition-all shadow-[0_0_20px_rgba(200,57,26,0.3)]">
          Iniciar Criação
        </Link>
      </section>

      <section>
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-xl font-bold text-white">Criativos Recentes</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Exemplo de card vazio */}
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-neutral-800 rounded-xl bg-neutral-900/50 text-neutral-500">
            <span className="text-sm">Nenhum criativo gerado ainda.</span>
            <Link href="/criar" className="text-[#C8391A] mt-2 text-sm font-medium hover:underline">
              Crie o primeiro
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
