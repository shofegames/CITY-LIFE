// Generador pseudoaleatorio determinístico (mulberry32): la ciudad es siempre la misma.
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function hashSeed(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= n & 0xffffffff;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
