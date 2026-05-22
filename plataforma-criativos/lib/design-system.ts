export const TIPO_SCALE = {
  // Formato 4:5 (1080x1350) — escala base
  portrait: {
    dispLarge:  { fontSize: '108px', lineHeight: '0.88' },
    dispMedium: { fontSize: '88px',  lineHeight: '0.93' },
    dispSmall:  { fontSize: '72px',  lineHeight: '0.95' },
    heading:    { fontSize: '48px',  lineHeight: '1.0'  },
    body:       { fontSize: '38px',  lineHeight: '1.55' },
    caption:    { fontSize: '28px',  lineHeight: '1.4'  },
    tag:        { fontSize: '18px',  letterSpacing: '3px' },
    slideNum:   { fontSize: '18px',  letterSpacing: '2px' },
  },
  // Formato 1:1 (1080x1080)
  square: {
    dispLarge:  { fontSize: '100px', lineHeight: '0.86' },
    dispMedium: { fontSize: '80px',  lineHeight: '0.9'  },
    body:       { fontSize: '34px',  lineHeight: '1.55' },
    tag:        { fontSize: '18px',  letterSpacing: '3px' },
  },
  // Story/Reel 9:16 (1080x1920)
  story: {
    dispLarge:  { fontSize: '148px', lineHeight: '0.84' },
    dispMedium: { fontSize: '108px', lineHeight: '0.88' },
    body:       { fontSize: '44px',  lineHeight: '1.55' },
    tag:        { fontSize: '22px',  letterSpacing: '4px' },
  },
  // Banner 16:9 (1920x1080)
  landscape: {
    dispLarge:  { fontSize: '120px', lineHeight: '0.84' },
    dispMedium: { fontSize: '96px',  lineHeight: '0.88' },
    body:       { fontSize: '30px',  lineHeight: '1.5'  },
    tag:        { fontSize: '20px',  letterSpacing: '3px' },
  },
} as const;

export const FORMATOS = {
  portrait:  { width: 1080, height: 1350, label: 'Instagram 4:5',    scale: 0.24 },
  square:    { width: 1080, height: 1080, label: 'Instagram 1:1',    scale: 0.28 },
  story:     { width: 1080, height: 1920, label: 'Stories / Reels',  scale: 0.19 },
  landscape: { width: 1920, height: 1080, label: 'YouTube / 16:9',   scale: 0.22 },
  banner:    { width: 1200, height: 628,  label: 'Meta Ads Banner',  scale: 0.30 },
} as const;

export const TEMAS = {
  dark_brutalista: {
    label: 'Dark Brutalista',
    bg: 'var(--void)',
    accent: 'var(--fire)',
    text: 'var(--bone)',
    sub: 'var(--sub)',
    tape: 'var(--fire)',
    tag_color: 'var(--fire)',
  },
  light_editorial: {
    label: 'Light Editorial',
    bg: 'var(--paper)',
    accent: 'var(--fire)',
    text: 'var(--ink)',
    sub: '#444',
    tape: 'var(--ink)',
    tag_color: 'var(--ink)',
  },
  fire_solido: {
    label: 'Fire Sólido',
    bg: 'var(--fire)',
    accent: 'rgba(0,0,0,0.8)',
    text: 'rgba(0,0,0,0.85)',
    sub: 'rgba(0,0,0,0.55)',
    tape: 'rgba(240,235,224,0.35)',
    tag_color: 'rgba(0,0,0,0.45)',
  },
  tech_lime: {
    label: 'Tech / TagServer',
    bg: 'var(--ts-bg)',
    accent: 'var(--ts-lime)',
    text: 'var(--bone)',
    sub: '#a0aec0',
    tape: 'var(--ts-lime)',
    tag_color: 'var(--ts-lime)',
  },
  gold_premium: {
    label: 'Gold Premium',
    bg: 'var(--carbon)',
    accent: 'var(--gold)',
    text: 'var(--bone)',
    sub: 'var(--sub)',
    tape: 'var(--gold)',
    tag_color: 'var(--gold)',
  },
  midnight_premium: {
    label: 'Midnight Premium',
    bg: 'var(--mid-bg)',
    accent: 'var(--mid-acc)',
    text: 'rgba(248,249,250,0.92)',
    sub: '#a0aec0',
    tape: 'var(--mid-acc)',
    tag_color: 'var(--mid-acc)',
  },
} as const;
