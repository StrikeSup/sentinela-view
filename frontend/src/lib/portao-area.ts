export type PontoPortao = { x: number; y: number };
export type RoiPortao = { x: number; y: number; w: number; h: number; pontos?: PontoPortao[] };

/** Coordinates remain normalized to the full image; old rectangular areas still work. */
export function pontosDaArea(roi: RoiPortao): PontoPortao[] {
  return roi.pontos ?? [
    { x: roi.x, y: roi.y }, { x: roi.x + roi.w, y: roi.y },
    { x: roi.x + roi.w, y: roi.y + roi.h }, { x: roi.x, y: roi.y + roi.h },
  ];
}

export function areaDosPontos(pontos: PontoPortao[]): RoiPortao | null {
  if (pontos.length < 3 || pontos.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const ps = pontos.map((p) => ({ x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }));
  let area = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]; const b = ps[(i + 1) % ps.length];
    if (!a || !b) return null;
    area += a.x * b.y - b.x * a.y;
  }
  // Reject crossed edges: an ambiguous outline must never silently become a rectangle.
  const orient = (a: PontoPortao, b: PontoPortao, c: PontoPortao) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    if (j === i + 1 || (i === 0 && j === ps.length - 1)) continue;
    const a = ps[i], b = ps[(i + 1) % ps.length], c = ps[j], d = ps[(j + 1) % ps.length];
    if (!a || !b || !c || !d) return null;
    if (orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0) return null;
  }
  if (Math.abs(area) < 0.0008) return null;
  const x = Math.min(...ps.map((p) => p.x)), y = Math.min(...ps.map((p) => p.y));
  return { x, y, w: Math.max(...ps.map((p) => p.x)) - x, h: Math.max(...ps.map((p) => p.y)) - y, pontos: ps };
}

export function dentroDoPoligono(p: PontoPortao, pontos: PontoPortao[]): boolean {
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i], b = pontos[j];
    if (!a || !b) continue;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Mask in cropped-image coordinates, shared by live frames and reference photos. */
export function mascaraDaArea(roi: RoiPortao, largura: number, altura: number): Uint8Array {
  const mascara = new Uint8Array(largura * altura);
  if (!roi.pontos) return mascara.fill(1);
  for (let y = 0; y < altura; y++) for (let x = 0; x < largura; x++) {
    mascara[y * largura + x] = Number(dentroDoPoligono({
      x: roi.x + ((x + 0.5) / largura) * roi.w,
      y: roi.y + ((y + 0.5) / altura) * roi.h,
    }, roi.pontos));
  }
  return mascara;
}