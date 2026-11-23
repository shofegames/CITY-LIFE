import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { PROTAGONISTS } from '../player/Protagonists.js';

// ============================================================================
// HISTORIA DE CITY LIFE — "San Vega no perdona"
// Nico Vargas llega a la ciudad a trabajar en el Taller Duarte. Lara Quintero
// le consigue autos imposibles a Don Celso Ibarra. Sus caminos se cruzan en
// el golpe al camión blindado.
// Para agregar una misión: sumar un objeto a "missions" (ver MissionSystem.js).
// ============================================================================

const V = (x, z) => new THREE.Vector3(x, 0, z);

export const LOCATIONS = {
  taller: { x: -108.3, z: 66, name: 'Taller Duarte' },
  tallerGarage: V(-104.75, 52),
  hotel: V(404.75, -52),
  plaza: V(40, -40),
  puerto: V(108, -250),
  rulo: { x: 208.3, z: -240, name: 'Rulo' },
  celso: { x: -307.7, z: -335, name: 'Mansión Ibarra' },
  aurora: V(-250, -395.25),
  dock: V(204.75, -258),
};

export function buildStory() {
  const characters = {
    nico: { name: PROTAGONISTS.nico.name, color: PROTAGONISTS.nico.color },
    lara: { name: PROTAGONISTS.lara.name, color: PROTAGONISTS.lara.color },
    marta: { name: 'Marta Duarte', initial: 'M', color: '#ffd166', look: { skin: 0xe0ac87, shirt: 0x34495e, pants: 0x2c3e50, hair: 0x6b4a2a, hairStyle: 'long', build: 'slim', shoes: 0x3b2a1a } },
    rulo: { name: 'Rulo', initial: 'R', color: '#7bd389', look: { skin: 0x9c6644, shirt: 0x111111, jacket: 0x1e8449, pants: 0x34495e, hair: 0x111111 } },
    celso: { name: 'Don Celso Ibarra', initial: 'C', color: '#c77dff', look: { skin: 0xf1c7a5, shirt: 0xf5f5f5, jacket: 0x2b2b44, pants: 0x2b2b44, hair: 0xb8b8b8, shoes: 0x111111 } },
    cliente: { name: 'Cliente', color: '#bbbbbb' },
    radio: { name: 'Radio policial', color: '#2a6bff' },
    ferran: { name: 'Ferrán', color: '#ff9f43' },
  };

  const missions = [
    // ------------------------------------------------------------------ NICO 1
    {
      id: 'm1', title: 'Primer día', giver: 'marta', character: 'nico', reward: 400,
      start: { ...LOCATIONS.taller, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Marta',
          dialog: [
            ['marta', '¡Vos debés ser Nico! Tu primo dice que manejás como nadie.'],
            ['nico', 'Algo así. Necesito laburo, Marta. Lo que sea.'],
            ['marta', 'Tengo un Pico recién arreglado. Hay que entregarlo en el hotel de Costa Azul.'],
            ['marta', 'El cliente es exigente. Lo quiero sin un rayón y a tiempo.'],
          ],
          enter(ctx) {
            const g = LOCATIONS.tallerGarage;
            ctx.vars.car = ctx.car('pico', 0xe8b923, g.x, g.z + 4, 0);
            ctx.vars.car.blip = '#ffd166';
          },
        },
        {
          text: 'Subite al Pico amarillo',
          enter(ctx) { ctx.gps(ctx.vars.car); },
          update: (ctx) => ctx.inVehicle(ctx.vars.car),
        },
        {
          text: 'Llevá el Pico al hotel de Costa Azul y frená en el punto',
          enter(ctx) {
            ctx.vars.dest = ctx.marker(LOCATIONS.hotel.x, LOCATIONS.hotel.z, { color: 0xffd166, radius: 4.5, label: '' });
            ctx.gps(LOCATIONS.hotel);
            ctx.timer(170);
          },
          update(ctx) {
            const car = ctx.vars.car;
            ctx.info(`Estado del auto: ${Math.round(100 - car.damage)}%`);
            if (!ctx.inVehicle(car)) ctx.objective('Volvé al Pico amarillo');
            else ctx.objective('Llevá el Pico al hotel de Costa Azul y frená en el punto');
            return ctx.inVehicle(car) && ctx.inside(ctx.vars.dest, 1) && car.speed < 3;
          },
        },
        {
          text: 'Bajate del auto',
          enter(ctx) { ctx.timer(null); ctx.gps(null); ctx.info(null); },
          dialog: [['cliente', 'Justo a tiempo. Impecable. Decile a Marta que vuelvo a llamar.']],
          update: (ctx) => !ctx.inVehicle(),
        },
      ],
      check(ctx) {
        const car = ctx.vars.car;
        if (car?.dead) return 'El Pico quedó destruido';
        if (car && car.damage > 60) return 'El auto quedó muy dañado';
        if (car && !ctx.inVehicle(car) && car.pos.distanceTo(ctx.pos) > 80) return 'Abandonaste el auto del cliente';
      },
      after: 'Marta tiene más trabajo para vos. Buscá la M en el mapa.',
    },

    // ------------------------------------------------------------------ NICO 2
    {
      id: 'm2', title: 'Carga frágil', giver: 'marta', character: 'nico', requires: ['m1'], reward: 700,
      start: { ...LOCATIONS.taller, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Marta',
          dialog: [
            ['marta', 'Un amigo dejó un paquete en Plaza Vega. Es electrónica cara y muy delicada.'],
            ['marta', 'Llevalo al depósito del Puerto Industrial. Cada golpe lo daña.'],
            ['nico', '¿Qué hay adentro?'],
            ['marta', 'Mejor no preguntes, Nico.'],
          ],
        },
        {
          text: 'Buscá el paquete en Plaza Vega',
          enter(ctx) {
            ctx.vars.pick = ctx.marker(LOCATIONS.plaza.x, LOCATIONS.plaza.z, { color: 0x4fd17a, radius: 2.5 });
            ctx.gps(LOCATIONS.plaza);
          },
          update: (ctx) => ctx.inside(ctx.vars.pick, ctx.inVehicle() ? 2 : 0),
        },
        {
          text: 'Llevá el paquete al depósito del puerto sin golpearlo',
          enter(ctx) {
            ctx.jingle('pickup');
            ctx.removeMarker(ctx.vars.pick);
            ctx.vars.integrity = 100;
            ctx.vars.dest = ctx.marker(LOCATIONS.puerto.x, LOCATIONS.puerto.z, { color: 0xffd166, radius: 3.5 });
            ctx.gps(LOCATIONS.puerto);
            ctx.timer(200);
            const hit = (e) => {
              const pv = ctx.vehicle;
              if (pv && (e.vehicle === pv || e.other === pv)) ctx.vars.integrity -= e.impact * 3.2;
            };
            const land = (fall) => { if (fall > 8) ctx.vars.integrity -= (fall - 8) * 4; };
            ctx.vars.offs = [bus.on('vehicle:crash', hit), bus.on('player:land', land)];
          },
          update(ctx) {
            ctx.info(`Paquete: ${Math.max(0, Math.round(ctx.vars.integrity))}%`);
            if (ctx.vars.integrity <= 0) return 'El paquete se rompió';
            return ctx.inside(ctx.vars.dest, ctx.inVehicle() ? 2.5 : 0);
          },
          exit(ctx) { ctx.vars.offs?.forEach((f) => f()); ctx.vars.offs = null; },
        },
      ],
      cleanup(ctx) { ctx.vars.offs?.forEach((f) => f()); },
      reward: (ctx) => 400 + Math.round(Math.max(0, ctx.vars.integrity || 0) * 4),
      after: 'Rulo, del Puerto Industrial, anda buscando pilotos (R en el mapa).',
    },

    // ------------------------------------------------------------------ NICO 3 — CARRERA
    {
      id: 'm3', title: 'Carrera del puerto', giver: 'rulo', character: 'nico', requires: ['m1'], reward: 1500,
      start: { ...LOCATIONS.rulo, npcDx: 1.4, npcYaw: -Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Rulo',
          dialog: [
            ['rulo', '¿Vos sos el nuevo de Marta? Acá en el puerto se corre de noche y por plata.'],
            ['rulo', 'Te presto mi Toro. Vuelta completa: Costanera, Mercado, Avenida Central y de vuelta acá.'],
            ['rulo', 'Si ganás, la plata es tuya. Si lo rompés... no quiero ni pensarlo.'],
          ],
          enter(ctx) {
            ctx.vars.car = ctx.car('toro', 0x1a237e, 232, -298.25, Math.PI / 2);
            ctx.vars.car.blip = '#7bd389';
            ctx.vars.r1 = ctx.car('furia', 0x8e44ad, 246, -298.25, Math.PI / 2);
            ctx.vars.r2 = ctx.car('toro', 0xff8f00, 238, -294.5, Math.PI / 2);
          },
        },
        {
          text: 'Subite al Toro y esperá la largada',
          enter(ctx) { ctx.gps(ctx.vars.car); },
          update: (ctx) => ctx.inVehicle(ctx.vars.car),
        },
        {
          text: 'Preparate...',
          enter(ctx) {
            ctx.gps(null);
            ctx.vars.count = 3.99;
            ctx.vars.lastShown = 4;
            ctx.vars.car.controls.hold = true;
          },
          update(ctx, dt) {
            ctx.vars.count -= dt;
            const n = Math.ceil(ctx.vars.count);
            if (n !== ctx.vars.lastShown && n > 0) {
              ctx.vars.lastShown = n;
              ctx.flash(String(n), '', 0.8);
              ctx.jingle('count');
            }
            // nadie se mueve antes de la largada
            for (const v of [ctx.vars.car, ctx.vars.r1, ctx.vars.r2]) { v.vx *= 0.5; v.vz *= 0.5; }
            return ctx.vars.count <= 0;
          },
        },
        {
          text: 'Ganá la carrera',
          enter(ctx) {
            ctx.flash('¡YA!', '', 1);
            ctx.jingle('go');
            ctx.vars.car.controls.hold = false;
            // circuito por los carriles (cada rival en su carril)
            const lane = (k) => [V(250, -298.25), V(497.25 - k * 3.5, -298.25), V(497.25 - k * 3.5, 98.25), V(4.25 + k * 3.5, 98.25), V(4.25 + k * 3.5, -298.25), V(236, -298.25)];
            ctx.vars.d1 = ctx.drive(ctx.vars.r1, lane(0), { maxSpeed: 33, offset: 0, cornerFactor: 0.9 });
            ctx.vars.d2 = ctx.drive(ctx.vars.r2, lane(1), { maxSpeed: 30.5, offset: 0, cornerFactor: 1 });
            ctx.vars.r1.blip = '#ff3b30';
            ctx.vars.r2.blip = '#ff3b30';
            ctx.vars.cps = [V(380, -300), V(500, -300), V(500, -100), V(500, 100), V(300, 100), V(100, 100), V(0, 100), V(0, -100), V(0, -300), V(130, -300), V(232, -300)];
            ctx.vars.idx = { player: 0, r1: 0, r2: 0 };
            ctx.vars.finish = [];
            ctx.vars.cpMarker = null;
            ctx.vars.setCp = () => {
              if (ctx.vars.cpMarker) ctx.removeMarker(ctx.vars.cpMarker);
              const i = ctx.vars.idx.player;
              if (i >= ctx.vars.cps.length) return;
              const c = ctx.vars.cps[i];
              ctx.vars.cpMarker = ctx.marker(c.x, c.z, { color: i === ctx.vars.cps.length - 1 ? 0xffffff : 0xff6b2c, radius: 9, height: 10 });
              ctx.gps(c);
            };
            ctx.vars.setCp();
          },
          update(ctx) {
            const V2 = ctx.vars;
            const cps = V2.cps;
            const racers = { player: ctx.vars.car.pos, r1: V2.r1.pos, r2: V2.r2.pos };
            for (const [k, p] of Object.entries(racers)) {
              if (V2.idx[k] >= cps.length) continue;
              const c = cps[V2.idx[k]];
              if (Math.hypot(p.x - c.x, p.z - c.z) < (k === 'player' ? 10 : 14)) {
                V2.idx[k]++;
                if (k === 'player') { ctx.jingle('checkpoint'); V2.setCp(); }
                if (V2.idx[k] >= cps.length) V2.finish.push(k);
              }
            }
            if (!ctx.inVehicle(V2.car) && V2.car.pos.distanceTo(ctx.pos) > 30) return 'Abandonaste la carrera';
            // posición actual
            const score = (k) => V2.idx[k] * 10000 - (V2.idx[k] < cps.length ? Math.hypot(racers[k].x - cps[V2.idx[k]].x, racers[k].z - cps[V2.idx[k]].z) : -V2.finish.indexOf(k));
            const order = ['player', 'r1', 'r2'].sort((a, b) => score(b) - score(a));
            const pos = V2.finish.includes('player') ? V2.finish.indexOf('player') + 1 : order.indexOf('player') + 1;
            ctx.info(`Posición ${pos}/3 · Control ${Math.min(V2.idx.player + 1, cps.length)}/${cps.length}`);
            if (V2.finish.includes('player')) {
              V2.place = V2.finish.indexOf('player') + 1;
              if (V2.place === 3) return 'Llegaste último';
              return true;
            }
            if (V2.finish.length >= 2) return 'Llegaste último';
          },
        },
        {
          text: 'Devolvele el Toro a Rulo',
          enter(ctx) {
            ctx.info(null);
            ctx.gps(null);
            ctx.vars.d1.paused = true;
            ctx.vars.d2.paused = true;
            ctx.say('rulo', ctx.vars.place === 1 ? '¡Ganaste, loco! Tenés un futuro en estas calles.' : 'Segundo. Nada mal para ser tu primera vez.');
          },
          update: (ctx) => ctx.stepTime > 3,
        },
      ],
      check(ctx) { if (ctx.vars.car?.dead) return 'El Toro de Rulo quedó destruido'; },
      reward: (ctx) => (ctx.vars.place === 1 ? 1500 : 500),
    },

    // ------------------------------------------------------------------ LARA 1 — SEGUIR
    {
      id: 'm4', title: 'Sombra', giver: 'celso', character: 'lara', reward: 900,
      start: { ...LOCATIONS.celso, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Don Celso',
          dialog: [
            ['celso', 'Lara, querida. Mi socio Ferrán me está mintiendo y quiero saber con quién se junta.'],
            ['celso', 'Está por salir en su Vento gris. Seguilo, pero que no te vea.'],
            ['lara', 'Discreción es mi segundo nombre. El primero es "cobro por adelantado".'],
            ['celso', 'Ja. Te pago cuando vuelvas.'],
          ],
          enter(ctx) {
            ctx.vars.myCar = ctx.car('atlas', 0x111111, -304.75, -350, 0);
            ctx.vars.myCar.blip = '#c77dff';
            ctx.vars.target = ctx.car('vento', 0x5d6d7e, -301.75, -378, 0);
          },
        },
        {
          text: 'Subite al Atlas negro',
          enter(ctx) { ctx.gps(ctx.vars.myCar); },
          update: (ctx) => ctx.inVehicle(),
        },
        {
          text: 'Seguí a Ferrán sin que te descubra',
          enter(ctx) {
            const t = ctx.vars.target;
            t.blip = '#ff9f43';
            t.driver = 'script';
            ctx.vars.drv = ctx.drive(t, ctx.route(t.pos, V(60, 200)), { maxSpeed: 13 });
            ctx.vars.far = 0;
            ctx.vars.close = 0;
            ctx.gps(t);
          },
          update(ctx, dt) {
            const t = ctx.vars.target;
            const d = t.pos.distanceTo(ctx.pos);
            ctx.vars.far = d > 110 ? ctx.vars.far + dt : 0;
            ctx.vars.close = d < 12 ? ctx.vars.close + dt : Math.max(0, ctx.vars.close - dt);
            const status = d < 18 ? 'MUY CERCA' : d > 85 ? 'LO ESTÁS PERDIENDO' : 'distancia segura';
            ctx.info(`Distancia: ${Math.round(d)} m · ${status}`);
            if (ctx.vars.far > 6) return 'Perdiste a Ferrán';
            if (ctx.vars.close > 3) return 'Ferrán te descubrió';
            if (!ctx.inVehicle() && d > 50) return 'Perdiste a Ferrán';
            return ctx.vars.drv.done;
          },
        },
        {
          text: 'Observá a Ferrán',
          enter(ctx) { ctx.info(null); ctx.gps(null); },
          dialog: [
            ['lara', 'Torre Meridian... Ferrán se reúne con la gente del blindado.'],
            ['lara', 'Don Celso no va a estar nada contento.'],
          ],
        },
      ],
      check(ctx) { if (ctx.vars.target?.dead) return 'El auto de Ferrán quedó destruido'; },
      after: 'Don Celso tiene un trabajo más grande para Lara.',
    },

    // ------------------------------------------------------------------ LARA 2 — ROBO + ESCAPE
    {
      id: 'm5', title: 'Gusto caro', giver: 'celso', character: 'lara', requires: ['m4'], reward: 2500,
      start: { ...LOCATIONS.celso, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Don Celso',
          dialog: [
            ['celso', 'Ferrán me traicionó. Así que voy a quedarme con su juguete favorito.'],
            ['celso', 'Su Aurora X está estacionado en Altos de Vega. Llevalo a mi muelle del puerto.'],
            ['celso', 'Ojo: la alarma está conectada con la policía.'],
            ['lara', 'Entonces voy a tener compañía.'],
          ],
          enter(ctx) {
            const a = LOCATIONS.aurora;
            ctx.vars.car = ctx.car('aurora', 0xff6b2c, a.x, a.z, Math.PI / 2);
            ctx.vars.car.blip = '#ff6b2c';
          },
        },
        {
          text: 'Robá el Aurora X',
          enter(ctx) { ctx.gps(ctx.vars.car); },
          update: (ctx) => ctx.inVehicle(ctx.vars.car),
        },
        {
          text: 'Perdé a la policía',
          enter(ctx) {
            ctx.setWanted(2);
            ctx.gps(null);
            ctx.say('radio', 'A todas las unidades: robo de vehículo de alta gama en Altos de Vega. Aurora X naranja.');
          },
          update: (ctx) => ctx.wanted === 0,
        },
        {
          text: 'Llevá el Aurora X al muelle de Don Celso',
          enter(ctx) {
            ctx.vars.dest = ctx.marker(LOCATIONS.dock.x, LOCATIONS.dock.z, { color: 0xc77dff, radius: 5 });
            ctx.gps(LOCATIONS.dock);
          },
          update(ctx) {
            if (ctx.wanted > 0) ctx.objective('Perdé a la policía antes de ir al muelle');
            else ctx.objective('Llevá el Aurora X al muelle de Don Celso');
            return ctx.wanted === 0 && ctx.inVehicle(ctx.vars.car) && ctx.inside(ctx.vars.dest, 1) && ctx.vars.car.speed < 3;
          },
        },
        {
          text: 'Bajate del auto',
          dialog: [['celso', 'Hermoso. Y Ferrán va a buscarlo toda la semana. Buen trabajo, Lara.']],
          update: (ctx) => !ctx.inVehicle(),
        },
      ],
      check(ctx) {
        const car = ctx.vars.car;
        if (car?.dead) return 'El Aurora X quedó destruido';
        if (car && !ctx.inVehicle(car) && car.pos.distanceTo(ctx.pos) > 70) return 'Abandonaste el Aurora X';
      },
      after: 'Marta y Don Celso preparan algo grande. Cuando terminen sus trabajos, busquen la M.',
    },

    // ------------------------------------------------------------------ CUALQUIERA — BUSCAR
    {
      id: 'm6', title: 'Paquetes perdidos', giver: 'marta', requires: ['m1'], reward: 1000,
      start: { ...LOCATIONS.taller, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Marta',
          dialog: [
            ['marta', 'Un repartidor se asustó y tiró cinco paquetes míos por Los Pinos.'],
            ['marta', 'Recuperalos antes de que alguien los abra. Tenés cuatro minutos.'],
          ],
        },
        {
          text: 'Encontrá los 5 paquetes en Los Pinos',
          enter(ctx) {
            const spots = [V(-447, 108), V(-208, 150), V(-340, 250), V(-150, 392), V(-408, 447)];
            ctx.vars.items = spots.map((p) => ctx.marker(p.x, p.z, { color: 0x4fd17a, radius: 2.2, height: 4 }));
            ctx.vars.got = 0;
            ctx.timer(240);
          },
          update(ctx) {
            for (const m of [...ctx.vars.items]) {
              if (ctx.inside(m, ctx.inVehicle() ? 1.5 : 0)) {
                ctx.removeMarker(m);
                ctx.vars.items = ctx.vars.items.filter((q) => q !== m);
                ctx.vars.got++;
                ctx.jingle('pickup');
              }
            }
            // GPS al paquete más cercano
            let best = null, bd = Infinity;
            for (const m of ctx.vars.items) {
              const d = Math.hypot(m.x - ctx.pos.x, m.z - ctx.pos.z);
              if (d < bd) { bd = d; best = m; }
            }
            ctx.gps(best ? V(best.x, best.z) : null);
            ctx.info(`Paquetes: ${ctx.vars.got}/5`);
            return ctx.vars.got >= 5;
          },
        },
      ],
    },

    // ------------------------------------------------------------------ FINAL — EL BLINDADO
    {
      id: 'm7', title: 'El blindado', giver: 'marta', requires: ['m2', 'm3', 'm5'], reward: 8000,
      start: { ...LOCATIONS.taller, npcDx: -1.4, npcYaw: Math.PI / 2 },
      steps: [
        {
          text: 'Hablá con Marta',
          dialog: [
            ['marta', 'Don Celso me contó todo: Ferrán mueve la plata sucia en un camión blindado.'],
            ['marta', 'Ahora mismo está dando vueltas por el centro. Tomá la Ranchero, es la más dura que tengo.'],
            ['yo', '¿Y el plan?'],
            ['marta', 'Chocalo hasta que se detenga, agarrá el bolso y volvé acá. Fácil.'],
            ['yo', 'Fácil, dice.'],
          ],
          enter(ctx) {
            const g = LOCATIONS.tallerGarage;
            ctx.vars.car = ctx.car('ranchero', 0x922b21, g.x, g.z - 8, 0);
            ctx.vars.car.blip = '#ffd166';
            ctx.vars.truck = ctx.car('blindado', 0x4a5058, 98.25, -60, 0, { awake: true });
            ctx.vars.truck.blip = '#ff3b30';
            ctx.vars.drv = ctx.drive(ctx.vars.truck, [V(100, -100), V(100, 300), V(-100, 300), V(-100, -100), V(100, -100)], { maxSpeed: 14, loop: true });
          },
        },
        {
          text: 'Subite a la Ranchero',
          enter(ctx) { ctx.gps(ctx.vars.car); },
          update: (ctx) => ctx.inVehicle(),
        },
        {
          text: 'Alcanzá el camión blindado y chocalo hasta detenerlo',
          enter(ctx) { ctx.gps(ctx.vars.truck); },
          update(ctx) {
            const t = ctx.vars.truck;
            ctx.info(`Blindaje del camión: ${Math.max(0, Math.round(100 - t.damage * 1.8))}%`);
            if (t.damage >= 55) {
              ctx.vars.drv.paused = true;
              return true;
            }
          },
        },
        {
          text: 'Bajate y agarrá el bolso con la plata',
          enter(ctx) {
            const t = ctx.vars.truck;
            const f = t.forward;
            ctx.info(null);
            ctx.flash('¡LO DETUVISTE!', '', 1.5);
            ctx.vars.bag = ctx.marker(t.pos.x - f.x * (t.hl + 2), t.pos.z - f.z * (t.hl + 2), { color: 0x4fd17a, radius: 1.6 });
            ctx.gps(V(ctx.vars.bag.x, ctx.vars.bag.z));
          },
          update: (ctx) => !ctx.inVehicle() && ctx.inside(ctx.vars.bag),
        },
        {
          text: 'Escapá de la policía',
          enter(ctx) {
            ctx.jingle('pickup');
            ctx.removeMarker(ctx.vars.bag);
            ctx.setWanted(3);
            ctx.gps(null);
            ctx.say('radio', 'Asalto a transporte de caudales en el centro. Todas las unidades disponibles.');
          },
          update: (ctx) => ctx.wanted === 0,
        },
        {
          text: 'Volvé al Taller Duarte con el bolso',
          enter(ctx) {
            const g = LOCATIONS.tallerGarage;
            ctx.vars.dest = ctx.marker(g.x, g.z, { color: 0xffd166, radius: 5 });
            ctx.gps(g);
          },
          update(ctx) {
            if (ctx.wanted > 0) ctx.objective('Perdé a la policía antes de volver al taller');
            else ctx.objective('Volvé al Taller Duarte con el bolso');
            return ctx.wanted === 0 && ctx.inside(ctx.vars.dest, ctx.inVehicle() ? 1 : 0);
          },
        },
        {
          text: '',
          dialog: [
            ['marta', 'Lo lograste. Ferrán está acabado y nosotros... tenemos para un buen rato.'],
            ['marta', 'Bienvenido de verdad a San Vega.'],
          ],
        },
      ],
      after: '¡Terminaste la historia principal! San Vega sigue abierta para explorar.',
    },
  ];

  return { characters, missions };
}
