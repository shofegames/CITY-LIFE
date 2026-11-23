import * as THREE from 'three';
import { VEHICLE_TYPES } from '../vehicles/VehicleTypes.js';
import { bus } from '../core/EventBus.js';

// ============================================================================
// Economy System: tiendas de ropa, taller (reparar/pintar), concesionario y
// propiedades con garaje, punto de guardado y negocio con ganancias diarias.
// ============================================================================

export const CLOTHING = {
  shirt: { label: 'Remeras', items: [
    ['Blanca', 0xf2f2f2, 40], ['Negra', 0x151515, 40], ['Roja', 0xc0392b, 60], ['Azul', 0x2f6fb3, 60],
    ['Verde', 0x27ae60, 60], ['Amarilla', 0xf1c40f, 70], ['Rosa', 0xff8fa3, 80], ['Turquesa', 0x16a085, 80],
  ] },
  jacket: { label: 'Camperas', items: [
    ['Sin campera', null, 0], ['Cuero negro', 0x1a1a1a, 350], ['Bordó', 0x7a1f2b, 280], ['De jean', 0x3b5b8a, 220],
    ['Verde militar', 0x4b5320, 240], ['Blanca', 0xeeeeee, 300],
  ] },
  pants: { label: 'Pantalones', items: [
    ['Jean', 0x2b3f63, 90], ['Negro', 0x1d1f26, 90], ['Beige', 0xd5c4a1, 110], ['Gris', 0x7f8c8d, 80], ['Blanco', 0xf0f0f0, 120],
  ] },
  shoes: { label: 'Zapatillas', items: [
    ['Blancas', 0xf2f2f2, 120], ['Negras', 0x222222, 120], ['Rojas', 0xc0392b, 160], ['Marrones', 0x6b4a2a, 140],
  ] },
  hair: { label: 'Color de pelo', items: [
    ['Negro', 0x111111, 30], ['Castaño', 0x5a3a22, 30], ['Rubio', 0xc8a060, 30], ['Pelirrojo', 0x9a3a1a, 30], ['Canoso', 0xa8a8a8, 30],
  ] },
  hairStyle: { label: 'Peinado', items: [['Corto', 'short', 50], ['Largo', 'long', 50]] },
};

const PAINT = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0x111111, 0xf4f4f2, 0x8e44ad, 0xff6b2c, 0x5d6d7e, 0x16a085];

export const PLACES = {
  shops: [
    { id: 'moda', kind: 'clothes', name: 'Moda Vega', x: -66, z: -308 },
    { id: 'surf', kind: 'clothes', name: 'Surf & Sol', x: 408, z: 135 },
    { id: 'taller', kind: 'repair', name: 'Taller Duarte — Pintura y reparación', x: -104.75, z: 84, radius: 4.5 },
    { id: 'dealer', kind: 'dealer', name: 'Concesionario Vega', x: 336, z: 308 },
  ],
  properties: [
    { id: 'casa', name: 'Casa Los Pinos', price: 9000, x: -262, z: 308, garage: { x: -245, z: 304.75, h: Math.PI / 2, cap: 1 } },
    { id: 'depto', name: 'Depto. Costa Azul', price: 18000, x: 408, z: -262, garage: { x: 404.75, z: -238, h: Math.PI, cap: 2 } },
    { id: 'bar', name: 'Bar La Ola', price: 25000, x: 408, z: 336, income: 450 },
    { id: 'mansion', name: 'Mansión Altos de Vega', price: 65000, x: -408, z: -460, garage: { x: -404.75, z: -440, h: 0, cap: 4 } },
  ],
};

export class Economy {
  constructor(game) {
    this.g = game;
    this.markers = new Map();
    this.prompt = null;
    this.prevHour = null;
    bus.on('vehicle:removed', (v) => this.onVehicleRemoved(v));
  }

  get st() {
    return this.g.gameState;
  }

  owns(id) {
    return (this.st?.properties || []).includes(id);
  }

  // ---------------------------------------------------------------- marcadores
  refreshMarkers() {
    for (const m of this.markers.values()) this.g.markers.remove(m.marker);
    this.markers.clear();
    const add = (key, x, z, opts, data) => {
      const y = this.g.world.collision.groundHeight(x, z, 2, 0);
      const marker = this.g.markers.add(x, y, z, { radius: 1.3, height: 3.5, ...opts });
      this.markers.set(key, { marker, ...data });
    };
    for (const s of PLACES.shops) {
      const color = { clothes: 0xff8fa3, repair: 0x4fc3f7, dealer: 0x9ff0b5 }[s.kind];
      add(s.id, s.x, s.z, { color, label: { clothes: 'T', repair: 'P', dealer: 'V' }[s.kind], radius: s.radius || 1.3 }, { type: s.kind, place: s });
    }
    for (const p of PLACES.properties) {
      const owned = this.owns(p.id);
      add(p.id, p.x, p.z, { color: owned ? 0x4cc9f0 : 0x4fd17a, label: owned ? 'H' : '$' }, { type: owned ? 'home' : 'forsale', place: p });
      if (owned && p.garage) add(p.id + ':garage', p.garage.x, p.garage.z, { color: 0x4cc9f0, label: 'G', radius: 3.5, height: 2.5 }, { type: 'garage', place: p });
    }
  }

  blips() {
    const out = [];
    for (const m of this.markers.values()) out.push({ x: m.marker.x, z: m.marker.z, color: m.marker.color, size: 4.5, label: m.marker.label, edge: false });
    return out;
  }

  // ---------------------------------------------------------------- por frame
  update(dt) {
    const g = this.g;
    this.prompt = null;
    if (!this.st) return;
    // ganancias diarias de los negocios (a las 7:00)
    const h = g.world.timeOfDay;
    if (this.prevHour != null && this.prevHour < 7 && h >= 7) this.payday();
    this.prevHour = h;
    if (g.missions.active && g.missions.active.def) {
      // durante misiones solo funcionan el taller y los garajes
    }
    const pv = g.playerVehicle;
    const pos = pv ? pv.pos : g.player.position;
    for (const [key, m] of this.markers) {
      if (!g.markers.inside(m.marker, pos, pv ? 1.5 : 0)) continue;
      const k = g.keyLabel('interact');
      if (m.type === 'repair' && pv) this.prompt = `<kbd>${k}</kbd> Taller: reparar y pintar`;
      else if (m.type === 'garage' && pv) this.prompt = `<kbd>${k}</kbd> Guardar el ${pv.T.name} en el garaje`;
      else if (m.type === 'garage' && !pv) this.prompt = `<kbd>${k}</kbd> Sacar un auto del garaje`;
      else if (!pv && m.type === 'clothes') this.prompt = `<kbd>${k}</kbd> Entrar a ${m.place.name}`;
      else if (!pv && m.type === 'dealer') this.prompt = `<kbd>${k}</kbd> Entrar al ${m.place.name}`;
      else if (!pv && m.type === 'forsale') this.prompt = `<kbd>${k}</kbd> Se vende: ${m.place.name} · $${m.place.price.toLocaleString('es-AR')}`;
      else if (!pv && m.type === 'home') this.prompt = `<kbd>${k}</kbd> Entrar a ${m.place.name}`;
      else continue;
      if (g.input.wasPressed('interact')) this.activate(key, m);
      return;
    }
  }

  activate(key, m) {
    const g = this.g;
    if (g.police.wanted > 0 && m.type !== 'repair') return g.ui.toast('No podés hacer eso con la policía encima');
    switch (m.type) {
      case 'clothes': return this.openClothes(m.place);
      case 'repair': return this.openRepair(m.place);
      case 'dealer': return this.openDealer(m.place);
      case 'forsale': return this.buyProperty(m.place);
      case 'home': return this.openHome(m.place);
      case 'garage': return g.playerVehicle ? this.storeVehicle(m.place) : this.openGarage(m.place);
    }
  }

  spend(amount) {
    if (this.st.money < amount) {
      this.g.ui.toast('No te alcanza la plata');
      this.g.audio.jingle('fail');
      return false;
    }
    this.g.addMoney(-amount);
    return true;
  }

  // ---------------------------------------------------------------- ropa
  openClothes(place) {
    const g = this.g;
    const id = g.protagonist.current;
    const render = () => {
      const look = g.protagonist.look(id);
      const sections = Object.entries(CLOTHING).map(([slot, cat]) => {
        const items = cat.items.map(([name, value, price], i) => {
          const current = look[slot] === value || (slot === 'jacket' && value === null && !look.jacket);
          const sw = typeof value === 'number' ? `<span class="sw" style="background:#${value.toString(16).padStart(6, '0')}"></span>` : '';
          return `<button class="btn shop-item ${current ? 'current' : ''}" data-slot="${slot}" data-i="${i}">${sw}<span>${name}</span><span class="price">${current ? 'Puesto' : price ? '$' + price : 'Gratis'}</span></button>`;
        }).join('');
        return `<div class="shop-section">${cat.label}</div><div class="shop-grid">${items}</div>`;
      }).join('');
      return sections;
    };
    g.openShop({ kind: 'TIENDA DE ROPA', title: place.name, sub: `Vestí a ${g.protagonist.info.name}. Cada prenda se compra y se pone al instante.`, render, camera: 'front',
      onClick: (el) => {
        const slot = el.dataset.slot, i = +el.dataset.i;
        if (!slot) return;
        const [, value, price] = CLOTHING[slot].items[i];
        const look = g.protagonist.look(id);
        if (look[slot] === value) return;
        if (!this.spend(price)) return;
        g.setLook(id, { ...look, [slot]: value });
        g.audio.jingle('money');
        return true;
      } });
  }

  // ---------------------------------------------------------------- taller
  openRepair(place) {
    const g = this.g;
    const v = g.playerVehicle;
    if (!v) return;
    const repairCost = () => Math.max(50, Math.round(v.damage * 9));
    const render = () => {
      const rows = [];
      rows.push(`<div class="shop-row"><div class="info">Reparar el ${v.T.name}<small>Estado actual: ${Math.round(100 - v.damage)}%</small></div>
        ${v.damage > 0.5 ? `<button class="btn btn-small" data-act="repair">$${repairCost()}</button>` : '<span class="muted">Impecable</span>'}</div>`);
      rows.push('<div class="shop-section">Pintura nueva · $200</div><div class="shop-grid">' + PAINT.map((c, i) => `<button class="btn shop-item ${v.color === c ? 'current' : ''}" data-paint="${i}"><span class="sw" style="background:#${c.toString(16).padStart(6, '0')}"></span><span class="price">${v.color === c ? 'Actual' : '$200'}</span></button>`).join('') + '</div>');
      if (g.police.wanted > 0) rows.push(`<p class="muted">${g.police.seen ? 'La policía te está viendo: así no te sirve cambiar la pintura.' : 'Si pintás el auto ahora, la policía va a perder tu rastro.'}</p>`);
      return rows.join('');
    };
    g.openShop({ kind: 'TALLER', title: place.name, sub: 'Dejamos tu auto como nuevo.', render, camera: 'car',
      onClick: (el) => {
        if (el.dataset.act === 'repair') {
          if (!this.spend(repairCost())) return;
          v.repair();
          g.ui.toast('Auto reparado');
          this.afterService();
          return true;
        }
        if (el.dataset.paint != null) {
          const c = PAINT[+el.dataset.paint];
          if (c === v.color || !this.spend(200)) return;
          v.paint(c);
          g.ui.toast('Pintura nueva');
          this.afterService();
          return true;
        }
      } });
  }

  afterService() {
    const p = this.g.police;
    if (p.wanted > 0 && !p.seen) {
      p.clear();
      this.g.ui.toast('Con el auto de otro color, la policía perdió tu rastro', 4);
    }
  }

  // ---------------------------------------------------------------- concesionario
  garageSpace() {
    for (const p of PLACES.properties) {
      if (!p.garage || !this.owns(p.id)) continue;
      const used = (this.st.garages[p.id] || []).length + this.outCount(p.id);
      if (used < p.garage.cap) return p;
    }
    return null;
  }

  outCount(propId) {
    return this.g.vehicles.vehicles.filter((v) => v.owned && v.owned.prop === propId).length;
  }

  openDealer(place) {
    const g = this.g;
    const list = Object.entries(VEHICLE_TYPES).filter(([, t]) => t.price > 0).sort((a, b) => a[1].price - b[1].price);
    const render = () => {
      const space = this.garageSpace();
      const head = space ? `<p class="muted">Lo entregamos en tu garaje de <b>${space.name}</b>.</p>` : '<p class="muted">Necesitás una propiedad con garaje libre para comprar un auto. Buscá los carteles <b>$</b> en el mapa.</p>';
      return head + list.map(([id, t]) => `<div class="shop-row"><div class="info">${t.name} <span class="muted">· ${t.category}</span>
        <small>Vel. máx. ${Math.round(t.vmax * 3.6)} km/h · ${Math.round(t.power / 746)} HP · tracción ${t.drive.toUpperCase()}</small></div>
        <button class="btn btn-small ${space ? '' : 'disabled'}" data-buy="${id}">$${t.price.toLocaleString('es-AR')}</button></div>`).join('');
    };
    g.openShop({ kind: 'CONCESIONARIO', title: place.name, sub: 'Autos nuevos, entrega inmediata.', render, camera: 'front',
      onClick: (el) => {
        const id = el.dataset.buy;
        if (!id) return;
        const space = this.garageSpace();
        if (!space) return g.ui.toast('Primero comprá una propiedad con garaje');
        const t = VEHICLE_TYPES[id];
        if (!this.spend(t.price)) return;
        (this.st.garages[space.id] ||= []).push({ type: id, color: t.palette[0], damage: 0 });
        g.ui.toast(`Tu ${t.name} te espera en el garaje de ${space.name}`, 4);
        g.saveGame(false);
        return true;
      } });
  }

  // ---------------------------------------------------------------- propiedades
  async buyProperty(p) {
    const g = this.g;
    const extra = p.garage ? `Garaje para ${p.garage.cap} auto${p.garage.cap > 1 ? 's' : ''}.` : `Negocio: deja $${p.income} por día.`;
    const ok = await g.ui.confirm(`Comprar ${p.name}`, `Precio: $${p.price.toLocaleString('es-AR')}. ${extra} También sirve para guardar la partida y descansar.`, 'Comprar');
    if (!ok) return;
    if (!this.spend(p.price)) return;
    (this.st.properties ||= []).push(p.id);
    this.st.garages[p.id] ||= [];
    this.refreshMarkers();
    g.ui.bigMessage('PROPIEDAD COMPRADA', p.name, 'pass', 3);
    g.audio.jingle('pass');
    g.saveGame(false);
  }

  openHome(p) {
    const g = this.g;
    const render = () => {
      const cars = (this.st.garages[p.id] || []).map((c) => VEHICLE_TYPES[c.type].name).join(', ');
      return `<div class="shop-row"><div class="info">Guardar partida<small>Guarda tu progreso en este navegador</small></div><button class="btn btn-small" data-act="save">Guardar</button></div>
        <div class="shop-row"><div class="info">Dormir hasta la mañana<small>Pasa el tiempo hasta las 8:00, recuperás la salud y se guarda la partida</small></div><button class="btn btn-small" data-act="sleep">Dormir</button></div>
        ${p.garage ? `<p class="muted">Garaje (${(this.st.garages[p.id] || []).length}/${p.garage.cap}): ${cars || 'vacío'}. Usá el punto <b>G</b> en la calle.</p>` : ''}
        ${p.income ? `<p class="muted">Este negocio te deja $${p.income} todos los días a las 7:00.</p>` : ''}`;
    };
    g.openShop({ kind: 'TU PROPIEDAD', title: p.name, sub: 'Bienvenido a casa.', render, camera: 'front',
      onClick: async (el) => {
        if (el.dataset.act === 'save') { g.saveGame(true); return; }
        if (el.dataset.act === 'sleep') {
          g.closeShop();
          g.ui.fade(true);
          await new Promise((r) => setTimeout(r, 700));
          const h = g.world.timeOfDay;
          if (h > 7) this.payday();
          g.world.timeOfDay = 8;
          this.prevHour = 8;
          g.player.health = 100;
          g.saveGame(false);
          g.ui.fade(false);
          g.ui.toast('Dormiste bien. Son las 8:00.');
        }
      } });
  }

  payday() {
    let total = 0;
    for (const p of PLACES.properties) if (p.income && this.owns(p.id)) total += p.income;
    if (total > 0) {
      this.g.addMoney(total);
      this.g.ui.toast(`Ganancias de tus negocios: $${total}`, 4);
    }
  }

  // ---------------------------------------------------------------- garajes
  storeVehicle(p) {
    const g = this.g;
    const v = g.playerVehicle;
    if (!v) return;
    if (v.kind === 'mission' || v.kind === 'police' || v.T.price === 0) return g.ui.toast('Este auto no se puede guardar');
    const list = (this.st.garages[p.id] ||= []);
    const outHere = v.owned && v.owned.prop === p.id ? 1 : 0;
    if (list.length + this.outCount(p.id) - outHere >= p.garage.cap) return g.ui.toast('El garaje está lleno');
    if (v.speed > 2) return g.ui.toast('Frená para guardar el auto');
    g.leaveVehicleImmediately();
    list.push({ type: v.typeId, color: v.color, damage: Math.round(v.damage) });
    v.owned = null;
    g.vehicles.remove(v);
    g.ui.toast(`Guardaste el ${v.T.name} en ${p.name}`);
    g.audio.jingle('pickup');
    g.saveGame(false);
  }

  openGarage(p) {
    const g = this.g;
    const render = () => {
      const list = this.st.garages[p.id] || [];
      if (!list.length) return '<p class="muted">El garaje está vacío. Comprá autos en el Concesionario Vega o guardá uno que consigas manejando hasta el punto G.</p>';
      return list.map((c, i) => `<div class="shop-row"><div class="info">${VEHICLE_TYPES[c.type].name}<small>${VEHICLE_TYPES[c.type].category} · estado ${100 - (c.damage || 0)}%</small></div><button class="btn btn-small" data-take="${i}">Sacar</button></div>`).join('');
    };
    g.openShop({ kind: 'GARAJE', title: p.name, sub: `Capacidad: ${p.garage.cap}`, render, camera: 'front',
      onClick: (el) => {
        if (el.dataset.take == null) return;
        const list = this.st.garages[p.id];
        const c = list.splice(+el.dataset.take, 1)[0];
        g.closeShop();
        const gp = p.garage;
        for (const o of [...g.vehicles.vehicles]) if (o !== g.playerVehicle && !o.owned && Math.hypot(o.pos.x - gp.x, o.pos.z - gp.z) < 7) g.vehicles.remove(o);
        const v = g.vehicles.spawn(c.type, c.color, gp.x, gp.z, gp.h, { kind: 'free' });
        if (!v) { list.push(c); return; }
        v.owned = { prop: p.id };
        if (c.damage) v.addDamage(c.damage);
        g.ui.toast(`Tu ${v.T.name} está listo`);
      } });
  }

  // Si un auto propio desaparece del mundo (quedó lejos), vuelve solo a su garaje.
  onVehicleRemoved(v) {
    if (!v.owned || !this.st) return;
    (this.st.garages[v.owned.prop] ||= []).push({ type: v.typeId, color: v.color, damage: Math.round(v.damage) });
    v.owned = null;
  }

  // Para guardar: los autos propios que están en la calle cuentan como guardados.
  garagesForSave() {
    const out = JSON.parse(JSON.stringify(this.st.garages || {}));
    for (const v of this.g.vehicles.vehicles) {
      if (v.owned) (out[v.owned.prop] ||= []).push({ type: v.typeId, color: v.color, damage: Math.round(v.damage) });
    }
    return out;
  }
}
