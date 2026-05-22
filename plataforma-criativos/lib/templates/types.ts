export type FormatoId = 'portrait' | 'square' | 'story' | 'landscape' | 'banner';
export type TemaId = 'dark_brutalista' | 'light_editorial' | 'fire_solido' | 'tech_lime' | 'gold_premium' | 'midnight_premium';

export interface Layout {
  id: string;
  label: string;
  descricao: string;           // instrução para a IA
  formatos_suportados: FormatoId[];
  componentes: string[];       // lista de atoms usados
  html_base: string;           // HTML template com {{variáveis}}
  svg_template?: string;       // Opcional: template SVG se for um layout com gráficos
}

export interface Slide {
  layout_id: string;
  tema_id: TemaId;
  numero: number;
  total: number;
  conteudo: {
    tag?: string;              // texto do mono-tag
    titulo: string;            // headline principal
    subtitulo?: string;        // subtítulo opcional
    corpo?: string;            // texto corpo
    cta?: string;              // call to action
    foto_url?: string;         // URL da foto do usuário
    dados?: DadoGrafico[];     // para layouts com gráficos
    lista?: ItemLista[];       // para layouts de lista
    citacao?: string;          // para layouts de quote
    stat_numero?: string;      // número grande (ex: "+47%")
    stat_label?: string;       // label do stat
  };
}

export interface DadoGrafico {
  label: string;
  valor: number;               // 0-100 (percentual da barra)
  valor_display: string;       // "110.000" ou "47%"
  destaque?: boolean;          // se true, usa cor de acento
}

export interface ItemLista {
  numero: string;              // "01", "02", ...
  titulo: string;
  descricao: string;
}
