require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ---- Supabase (opsiyonel - skor kaydi icin) ----
// .env'de URL yanlislikla '/rest/v1/' ekiyle yazilmis olsa bile calissin diye ek temizlenir.
let supabase = null;
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '');
const supabaseKey = process.env.SUPABASE_KEY || '';
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
    } catch (e) {
        console.error('Supabase istemcisi olusturulamadi:', e.message);
    }
} else {
    console.warn('SUPABASE_URL / SUPABASE_KEY tanimli degil; skorlar kaydedilmeyecek.');
}

app.use(express.static(path.join(__dirname, '.')));

// ---- Oyun Sabitleri (client ile ayni degerler) ----
const WORLD_SIZE = 3400;
const FOOD_COUNT = 800;          // haritadaki normal yem sayisi (tek kisilik modla benzer yogunluk)
const FOOD_CAP = 1400;           // ceset/boost yemleriyle birlikte ust sinir
const SNAKE_RADIUS = 8;          // client radiusFor() ile ayni
const PROTECT_MS = 1400;         // spawn korumasi (client PROTECT ile ayni)
const TICK_MS = 50;              // 20 tick/sn
const BOOST_MIN_LEN = 15;        // client ile ayni
const BOOST_COST_PER_TICK = 0.42; // client 0.14/kare @60fps = 8.4/sn -> 20 tick'te 0.42
const EAT_MAX_DIST = 300;        // yem yeme mesafe dogrulamasi (gecikme payi dahil)

// ---- Oyun Durumu ----
let players = {};
let foods = [];

function newFoodId() {
    return Math.random().toString(36).slice(2, 11);
}
function makeFood(x, y, r, val, color) {
    return { id: newFoodId(), x: x, y: y, r: r, val: val, color: color, phase: Math.random() * 6 };
}
function randomFood() {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (WORLD_SIZE - 40);
    return makeFood(
        Math.cos(a) * d,
        Math.sin(a) * d,
        3 + Math.random() * 2,
        1,
        `hsl(${Math.floor(Math.random() * 360)}, 90%, 62%)`
    );
}
for (let i = 0; i < FOOD_COUNT; i++) foods.push(randomFood());

// ---- Girdi dogrulama ----
function sanitizeName(n) {
    return String(n || 'Misafir').slice(0, 14) || 'Misafir';
}
function sanitizeSkin(s) {
    const v = parseInt(s, 10);
    return (v >= 0 && v <= 12) ? v : 0;
}
function sanitizeHex(c, fallback) {
    return (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : fallback;
}
function sanitizeColors(arr) {
    if (!Array.isArray(arr)) return null;
    const out = arr
        .filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
        .slice(0, 8);
    return out.length ? out : null;
}

// ---- Skor kaydi ----
async function saveScore(p) {
    if (!supabase || p.score <= 10) return;
    try {
        const { error } = await supabase.from('leaderboard').insert([
            { name: p.name, score: Math.floor(p.score) }
        ]);
        if (error) console.error('Skor kaydedilemedi:', error.message);
    } catch (e) {
        console.error('Skor kaydedilemedi:', e.message);
    }
}

// ---- Olum: ceset yemleri + bildirim ----
function killPlayer(id) {
    const p = players[id];
    if (!p) return;
    console.log(`${p.name} oldu. Skor: ${Math.floor(p.score)}`);

    // Ceset boyunca yem birak (client'taki killSnake gibi)
    const drops = [];
    if (p.segs && p.segs.length) {
        for (let i = 0; i < p.segs.length; i += 2) {
            if (foods.length + drops.length >= FOOD_CAP) break;
            const g = p.segs[i];
            if (!g || typeof g.x !== 'number' || typeof g.y !== 'number') continue;
            drops.push(makeFood(g.x, g.y, 4 + Math.random() * 3, 3, p.rep));
        }
    }
    if (drops.length) {
        foods.push(...drops);
        io.emit('foodsSpawned', drops);
    }

    saveScore(p); // beklemeye gerek yok, kendi icinde hatayi loglar

    delete players[id];
    io.emit('playerDied', id);
}

// ---- Sunucu otoriteli carpisma kontrolu ----
function checkCollisions() {
    const ids = Object.keys(players);
    const now = Date.now();
    const dead = [];
    for (let i = 0; i < ids.length; i++) {
        const a = players[ids[i]];
        if (!a || !a.segs || !a.segs.length) continue;
        if (now - a.spawnTime < PROTECT_MS) continue; // spawn korumasi
        const head = a.segs[0];
        // Harita siniri
        if (Math.hypot(head.x, head.y) > WORLD_SIZE - SNAKE_RADIUS) {
            dead.push(ids[i]);
            continue;
        }
        // Diger yilanlarin govdeleri
        const rr = SNAKE_RADIUS * 0.72 + SNAKE_RADIUS;
        let hit = false;
        for (let j = 0; j < ids.length && !hit; j++) {
            if (i === j) continue;
            const b = players[ids[j]];
            if (!b || !b.segs) continue;
            for (let k = 0; k < b.segs.length; k += 2) {
                const seg = b.segs[k];
                if (!seg) continue;
                const dx = seg.x - head.x, dy = seg.y - head.y;
                if (dx * dx + dy * dy < rr * rr) { hit = true; break; }
            }
        }
        if (hit) dead.push(ids[i]);
    }
    for (const id of dead) killPlayer(id);
}

// ---- Boost ekonomisi (sunucu otoriteli) ----
function boostTick(now) {
    const drops = [];
    for (const id in players) {
        const p = players[id];
        if (!p.boosting) continue;
        if (p.length > BOOST_MIN_LEN) {
            p.length -= BOOST_COST_PER_TICK;
            if (now - p.lastDrop > 110 && p.segs && p.segs.length &&
                foods.length + drops.length < FOOD_CAP) {
                p.lastDrop = now;
                const tail = p.segs[p.segs.length - 1];
                if (tail && typeof tail.x === 'number') {
                    drops.push(makeFood(tail.x, tail.y, 4 + Math.random() * 2, 3, p.rep));
                }
            }
        } else {
            p.boosting = false;
        }
    }
    if (drops.length) {
        foods.push(...drops);
        io.emit('foodsSpawned', drops);
    }
}

io.on('connection', (socket) => {
    console.log('Yeni oyuncu baglandi:', socket.id);

    socket.on('join', (data) => {
        data = data || {};
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * WORLD_SIZE * 0.6;
        players[socket.id] = {
            id: socket.id,
            name: sanitizeName(data.name),
            skin: sanitizeSkin(data.skin),
            skinColors: sanitizeColors(data.skinColors),
            rep: sanitizeHex(data.rep, '#39ff14'),
            x: Math.cos(a) * d,
            y: Math.sin(a) * d,
            angle: Math.random() * Math.PI * 2,
            length: 10,
            segs: [],
            alive: true,
            score: 0,
            boosting: false,
            spawnTime: Date.now(),
            lastDrop: 0
        };

        // Yeni oyuncuya mevcut durumu gonder
        socket.emit('init', {
            id: socket.id,
            players: players,
            foods: foods,
            worldSize: WORLD_SIZE
        });

        // Digerlerine yeni oyuncuyu bildir
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('update', (data) => {
        const p = players[socket.id];
        if (!p || !data) return;
        if (typeof data.x === 'number') p.x = data.x;
        if (typeof data.y === 'number') p.y = data.y;
        if (typeof data.angle === 'number') p.angle = data.angle;
        p.boosting = !!data.boosting;
        if (Array.isArray(data.segs) && data.segs.length <= 600) p.segs = data.segs;
        // NOT: length client'tan ALINMAZ - uzunlukta sunucu otoritedir.
    });

    socket.on('eatFood', (foodId) => {
        const p = players[socket.id];
        if (!p) return;
        const idx = foods.findIndex(f => f.id === foodId);
        if (idx === -1) return;
        const f = foods[idx];
        // Mesafe dogrulamasi (gecikme payi ile)
        const dx = f.x - p.x, dy = f.y - p.y;
        if (dx * dx + dy * dy > EAT_MAX_DIST * EAT_MAX_DIST) return;

        foods.splice(idx, 1);
        p.length += f.val;
        p.score += f.val;

        let replacement = null;
        if (foods.length < FOOD_COUNT) {
            replacement = randomFood();
            foods.push(replacement);
        }
        io.emit('foodEaten', { foodId: foodId, newFood: replacement, playerId: socket.id });
    });

    socket.on('leave', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrildi:', socket.id);
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
        }
    });
});

// ---- Oyun dongusu: 20 tick/sn ----
setInterval(() => {
    const now = Date.now();
    boostTick(now);
    checkCollisions();
    io.emit('stateUpdate', players);
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda calisiyor...`);
});
