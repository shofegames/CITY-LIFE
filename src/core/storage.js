// Acceso seguro a localStorage: en modo privado o con almacenamiento bloqueado
// el juego sigue funcionando, solo que sin persistencia.
export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('[storage] no se pudo guardar', key, err);
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* sin almacenamiento */
  }
}
