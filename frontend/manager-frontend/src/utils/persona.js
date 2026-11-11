// Имя личности в списках выбора: холодные помечены «(Х)».
export function personaLabel(p) {
  return p.traffic_type === 'cold' ? `${p.name} (Х)` : p.name;
}
