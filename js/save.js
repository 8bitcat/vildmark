// VILDMARK — world persistence: localStorage + export/import as file
const INDEX_KEY = 'vildmark_worlds';
const WORLD_KEY = (name) => 'vildmark_world_' + name;

export function listWorlds() {
  try {
    const idx = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    return idx
      .map((name) => {
        const s = loadWorld(name);
        return s ? { name, day: s.day ?? 0, savedAt: s.savedAt, edits: (s.edits || []).length } : null;
      })
      .filter(Boolean);
  } catch { return []; }
}

export function loadWorld(name) {
  try { return JSON.parse(localStorage.getItem(WORLD_KEY(name))); } catch { return null; }
}

export function saveWorld(state) {
  try {
    localStorage.setItem(WORLD_KEY(state.name), JSON.stringify(state));
    const idx = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
    if (!idx.includes(state.name)) {
      idx.unshift(state.name);
      localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    }
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function deleteWorld(name) {
  localStorage.removeItem(WORLD_KEY(name));
  const idx = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]').filter((n) => n !== name);
  localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
}

export function exportWorld(name) {
  const s = loadWorld(name);
  if (!s) return false;
  const blob = new Blob([JSON.stringify(s)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vildmark-' + name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

export function importWorld(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (typeof s.seed !== 'number' || typeof s.name !== 'string') throw new Error('fel format');
        let name = s.name;
        while (loadWorld(name)) name = name + '_2';
        s.name = name;
        saveWorld(s);
        resolve(name);
      } catch (e) { reject(e); }
    };
    r.onerror = reject;
    r.readAsText(file);
  });
}
