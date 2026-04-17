import React, { useEffect, useRef, useState } from 'react';
import { Peer, DataConnection } from 'peerjs';

// =========================================================
// 1. CONFIGURACIÓN DEL CIRCUITO
// =========================================================
const createRoundedTrack = (points: {x: number, y: number}[], rounding: number) => {
  const result: {x: number, y: number}[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p0 = points[(i - 1 + n) % n];
    const p2 = points[(i + 1) % n];

    const dx0 = p0.x - p1.x; const dy0 = p0.y - p1.y;
    const dx2 = p2.x - p1.x; const dy2 = p2.y - p1.y;
    const len0 = Math.hypot(dx0, dy0);
    const len2 = Math.hypot(dx2, dy2);
    
    // El radio máximo de redondeo es el 45% del segmento más corto para evitar que las curvas se superpongan
    const d = Math.min(rounding, len0 * 0.45, len2 * 0.45); 

    const ax = p1.x + (dx0 / len0) * d;
    const ay = p1.y + (dy0 / len0) * d;
    const bx = p1.x + (dx2 / len2) * d;
    const by = p1.y + (dy2 / len2) * d;

    // Generar curva Bezier cuadrática para suavizar la esquina
    const segments = 8;
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const inv = 1 - t;
      const x = inv * inv * ax + 2 * inv * t * p1.x + t * t * bx;
      const y = inv * inv * ay + 2 * inv * t * p1.y + t * t * by;
      result.push({ x, y });
    }
  }
  return result;
};

const centerPath = [
  {x: 1000, y: 3200}, // Start / Finish Line (Going North)
  {x: 1000, y: 1500}, // End of main straight
  {x: 1200, y: 1000}, // Turn 1 (Right)
  {x: 1800, y: 1000}, // Turn 2 (Right)
  {x: 2000, y: 1500}, // Esses Entry (Right)
  {x: 1800, y: 2000}, // Esses Mid (Left)
  {x: 2200, y: 2500}, // Esses Mid (Right)
  {x: 2000, y: 3000}, // Esses Exit (Left)
  {x: 2500, y: 3500}, // Sweeper Entry
  {x: 3500, y: 3500}, // Sweeper Mid
  {x: 3800, y: 2500}, // Sweeper Mid
  {x: 3800, y: 1200}, // Straight before Hairpin
  {x: 3700, y: 500},  // Hairpin Entry (Braking zone)
  {x: 3200, y: 300},  // Hairpin Apex
  {x: 2700, y: 600},  // Hairpin Exit
  {x: 2500, y: 1200}, // Tight left
  {x: 2000, y: 500},  // Long diagonal straight
  {x: 1200, y: 300},  // Diagonal End
  {x: 500, y: 500},   // Hard left
  {x: 300, y: 1500},  // Carousel start
  {x: 300, y: 2500},  // Carousel mid
  {x: 600, y: 3200}   // Carousel exit to straight
];

const roundedCenter = createRoundedTrack(centerPath, 350);
const trackOuter: {x: number, y: number}[] = [];
const trackInner: {x: number, y: number}[] = [];
const TRACK_WIDTH = 220;

for (let i = 0; i < roundedCenter.length; i++) {
  const p1 = roundedCenter[(i - 1 + roundedCenter.length) % roundedCenter.length];
  const p2 = roundedCenter[(i + 1) % roundedCenter.length];
  const curr = roundedCenter[i];
  
  let tx = p2.x - p1.x;
  let ty = p2.y - p1.y;
  const tLen = Math.hypot(tx, ty);
  tx /= tLen;
  ty /= tLen;
  
  const nx = -ty;
  const ny = tx;
  
  trackOuter.push({ x: curr.x + nx * (TRACK_WIDTH/2), y: curr.y + ny * (TRACK_WIDTH/2) });
  trackInner.push({ x: curr.x - nx * (TRACK_WIDTH/2), y: curr.y - ny * (TRACK_WIDTH/2) });
}

const finishLine = { x1: 850, y1: 2500, x2: 1150, y2: 2500 };

// Generar decoraciones ornamentales para el fondo
const mapDecorations: {x: number, y: number, type: string, size: number, color: string, thickness: number, angle: number}[] = [];
const DEC_TYPES = ['circle', 'cross', 'triangle', 'square', 'ring'];
const DEC_COLORS = ['rgba(0, 255, 204, 0.1)', 'rgba(255, 0, 255, 0.1)', 'rgba(59, 130, 246, 0.1)', 'rgba(255, 230, 0, 0.1)', 'rgba(255, 0, 100, 0.1)'];

let seed = 1337;
const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
};
for (let i = 0; i < 500; i++) {
    mapDecorations.push({
        x: (random() * 5000) - 500,
        y: (random() * 5000) - 500,
        type: DEC_TYPES[Math.floor(random() * DEC_TYPES.length)],
        size: random() * 100 + 30,
        color: DEC_COLORS[Math.floor(random() * DEC_COLORS.length)],
        thickness: random() * 4 + 1,
        angle: random() * Math.PI * 2
    });
}

export default function App() {
  const [view, setView] = useState<'lobby' | 'creating' | 'joining' | 'playing'>('lobby');
  const [roomId, setRoomId] = useState('');
  const [joinId, setJoinId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSolo, setIsSolo] = useState(false);
  
  const peerRef = useRef<Peer | null>(null);
  const connsRef = useRef<Map<string, DataConnection>>(new Map());
  const isHost = useRef<boolean>(false);
  const myIdRef = useRef<string>('');
  const handleDataRef = useRef<((data: any, conn: DataConnection) => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Limpiar error automáticamente tras unos segundos
  useEffect(() => {
     if (errorMsg) {
        const t = setTimeout(() => setErrorMsg(''), 5000);
        return () => clearTimeout(t);
     }
  }, [errorMsg]);

  // =========================================================
  // SISTEMA DE RED Y MODOS (LOBBY)
  // =========================================================
  const startSolo = () => {
    setIsSolo(true);
    myIdRef.current = 'local';
    setView('playing');
    setErrorMsg('');
  };

  const createRoom = () => {
    setIsSolo(false);
    setView('creating');
    setErrorMsg('');
    const id = `CAR-${Math.floor(100 + Math.random() * 900)}`; // Ej. CAR-123
    
    const peer = new Peer(id);
    
    peer.on('open', (assignedId) => {
      setRoomId(assignedId);
      myIdRef.current = assignedId;
    });

    peer.on('connection', (conn) => {
      connsRef.current.set(conn.peer, conn);
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      setErrorMsg("Error al crear: " + err.message);
      setView('lobby');
    });

    peerRef.current = peer;
    isHost.current = true;
  };

  const joinRoom = () => {
    if (!joinId) return;
    setIsSolo(false);
    setView('joining');
    setErrorMsg('');
    
    const peer = new Peer();
    
    peer.on('open', (id) => {
      myIdRef.current = id;
      const conn = peer.connect(joinId);
      connsRef.current.set(conn.peer, conn);
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      setErrorMsg("ID de sala no encontrado o error de conexión");
      setView('lobby');
    });

    peerRef.current = peer;
    isHost.current = false;
  };

  const setupConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      setView(v => (v !== 'playing' ? 'playing' : v));
    });
    conn.on('data', (data) => {
      if (handleDataRef.current) handleDataRef.current(data, conn);
    });
    conn.on('close', () => {
      if (!isHost.current) {
          setErrorMsg("El anfitrión se ha desconectado.");
          setView('lobby');
      } else {
          connsRef.current.delete(conn.peer);
      }
    });
    conn.on('error', (err) => {
      if (!isHost.current) {
          setErrorMsg("Se perdió la conexión con el anfitrión.");
          setView('lobby');
      }
    });
  };

  // =========================================================
  // BUCLE DE JUEGO PRINCIPAL
  // =========================================================
  useEffect(() => {
    if (view !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Config Inicial Coche Local
    let car = {
      // Si es solo, centramos en la meta. Si es online, host y guest se posicionan en paralelo.
      x: isSolo ? 1000 : (isHost.current ? 950 : 1050),
      y: 2800,
      prevX: isSolo ? 1000 : (isHost.current ? 950 : 1050),
      prevY: 2800,
      width: 20, height: 10,
      angle: -Math.PI / 2,
      vx: 0, vy: 0,
      speed: 0, maxSpeed: 8.5, acceleration: 0.14,
      friction: 0.988, lateralFriction: 0.975, rotationSpeed: 0.055,
      color: isSolo ? '#f27d26' : (isHost.current ? '#ef4444' : '#3b82f6') // Solo: Naranja. Host: Rojo. Guest: Azul
    };

    // Config Coche Remoto (Múltiples para Multi)
    let remoteCars: Record<string, {x: number, y: number, angle: number, width: number, height: number, color: string, lap: number, finished: boolean, speed: number}> = {};

    let thrusterTrail: { x: number, y: number, alpha: number, size: number, angle: number }[] = [];

    const TOTAL_LAPS = 3;
    let localLap = 1;

    // --- Generación del Patrón Futurista (Hexágonos) ---
    const hexSize = 30;
    const hexW = hexSize * Math.sqrt(3);
    const hexH = hexSize * 3;
    const patCanvas = document.createElement('canvas');
    patCanvas.width = hexW;
    patCanvas.height = hexH;
    const pCtx = patCanvas.getContext('2d');
    let trackPattern: CanvasPattern | string = "#2c2c34";
    
    if (pCtx) {
        pCtx.fillStyle = '#1c1c24'; // Fondo base de la pista
        pCtx.fillRect(0, 0, hexW, hexH);
        
        pCtx.strokeStyle = 'rgba(0, 255, 200, 0.15)'; // Cyan brillante tenue
        pCtx.lineWidth = 2;
        pCtx.shadowBlur = 5;
        pCtx.shadowColor = 'rgba(0, 255, 200, 0.6)';

        const drawHex = (cx: number, cy: number) => {
            pCtx.beginPath();
            for(let i=0; i<6; i++) {
                const angle = Math.PI / 3 * i - Math.PI / 6;
                const px = cx + hexSize * Math.cos(angle);
                const py = cy + hexSize * Math.sin(angle);
                if (i===0) pCtx.moveTo(px, py);
                else pCtx.lineTo(px, py);
            }
            pCtx.closePath();
            pCtx.stroke();
        };

        // Generar malla sin costuras
        drawHex(0, 0);
        drawHex(hexW, 0);
        drawHex(hexW/2, hexH/2);
        drawHex(0, hexH);
        drawHex(hexW, hexH);
        
        const pattern = ctx.createPattern(patCanvas, 'repeat');
        if (pattern) trackPattern = pattern;
    }
    // --------------------------------------------------

    let localFinished = false;
    let remoteFinished = false;
    let winState = ""; // "win", "lose", "solo"
    
    // Función para resetear completamente el estado de carrera
    const resetRace = () => {
        mode = isSolo ? "wait_start" : "racing";
        startTime = Date.now();
        lapTime = 0;
        uiMessage = isSolo ? "Acelera ↑ para cruzar la meta" : "";
        checkpoints.halfTrack = false;
        localLap = 1;
        localFinished = false;
        winState = "";
        
        Object.values(remoteCars).forEach(c => {
            c.lap = 1;
            c.finished = false;
            c.speed = 0;
        });
        
        car.x = isSolo ? 1000 : (isHost.current ? 950 : 1050 + (Math.random() * 50 - 25));
        car.y = 2800;
        car.prevX = car.x; car.prevY = car.y;
        car.vx = 0; car.vy = 0; car.speed = 0;
        car.angle = -Math.PI / 2;
    };

    let mode = isSolo ? "wait_start" : "racing";
    let startTime = Date.now();
    let lapTime = 0;
    let uiMessage = isSolo ? "Acelera ↑ para cruzar la meta" : "";
    let checkpoints = { halfTrack: false };
    
    // Escuchar actualizaciones del oponente por red
    handleDataRef.current = (data: any, sourceConn: DataConnection) => {
      if (data.type === 'state') {
        const id = data.id;
        if (!remoteCars[id]) {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];
            let hash = 0; for(let i=0; i<id.length; i++) hash += id.charCodeAt(i);
            const rColor = colors[hash % colors.length];
            remoteCars[id] = { x: data.x, y: data.y, angle: data.angle, width: 20, height: 10, color: rColor, lap: data.lap, finished: data.finished, speed: data.speed };
        }
        remoteCars[id].x = data.x;
        remoteCars[id].y = data.y;
        remoteCars[id].angle = data.angle;
        remoteCars[id].lap = data.lap;
        remoteCars[id].finished = data.finished;
        remoteCars[id].speed = data.speed;

        // Si soy host, reenvío esto al resto de clientes
        if (isHost.current) {
            Array.from(connsRef.current.values()).forEach(c => {
               if (c.peer !== sourceConn.peer && c.open) c.send(data);
            });
        }

      } else if (data.type === 'restart') {
        resetRace();
        // Host forwards restart
        if (isHost.current) {
            Array.from(connsRef.current.values()).forEach(c => {
               if (c.peer !== sourceConn.peer && c.open) c.send(data);
            });
        }
      }
    };

    // Gestionar Teclado
    const keys: Record<string, boolean> = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
      
      // Reiniciar meta/tiempo local y remoto
      if (e.key === " " && mode === "finished") {
          resetRace();
          if (!isSolo) {
              const rMsg = { type: 'restart' };
              Array.from(connsRef.current.values()).forEach(c => { if (c.open) c.send(rMsg); });
          }
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key in keys) { keys[e.key] = false; }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);

    // Helpers matemáticos de líneas para Colisiones
    const getCarCorners = (c: any) => {
      const cos = Math.cos(c.angle);
      const sin = Math.sin(c.angle);
      const hw = c.width / 2;
      const hh = c.height / 2;
      return [
        { x: c.x + cos * hw - sin * hh, y: c.y + sin * hw + cos * hh },
        { x: c.x + cos * hw - sin * -hh, y: c.y + sin * hw + cos * -hh },
        { x: c.x + cos * -hw - sin * -hh, y: c.y + sin * -hw + cos * -hh },
        { x: c.x + cos * -hw - sin * hh, y: c.y + sin * -hw + cos * hh }
      ];
    };

    const linesIntersect = (a: any, b: any, c: any, d: any) => {
      const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (det === 0) return false;
      const lambda = ((d.y - c.y) * (d.x - a.x) + (c.x - d.x) * (d.y - a.y)) / det;
      const gamma = ((a.y - b.y) * (d.x - a.x) + (b.x - a.x) * (d.y - a.y)) / det;
      return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
    };
    
    const trackLines: any[] = [];
    for (let i=0; i<trackOuter.length; i++) trackLines.push({a: trackOuter[i], b: trackOuter[(i+1)%trackOuter.length]});
    for (let i=0; i<trackInner.length; i++) trackLines.push({a: trackInner[i], b: trackInner[(i+1)%trackInner.length]});

    let animationFrameId: number;
    let lastNetworkSync = 0;

    const gameLoop = () => {
       // --- Físicas (Sólo afecta a tu coche Local) ---
       car.prevX = car.x;
       car.prevY = car.y;

       // Comportamiento estilo propulsor Flotante / Nave pura (Asteroids)
       if (keys.ArrowLeft) car.angle -= car.rotationSpeed;
       if (keys.ArrowRight) car.angle += car.rotationSpeed;

       // Aceleración y Frenado 2D (Aplica fuerza sólo hacia donde miras)
       if (keys.ArrowUp) { car.vx += Math.cos(car.angle) * car.acceleration; car.vy += Math.sin(car.angle) * car.acceleration; }
       // Frenar actúa como retropropulsor
       if (keys.ArrowDown) { car.vx -= Math.cos(car.angle) * (car.acceleration * 0.7); car.vy -= Math.sin(car.angle) * (car.acceleration * 0.7); }

       // Inercia global constante (La nave flota libremente en el espacio 2D)
       car.vx *= 0.985; 
       car.vy *= 0.985; 

       car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
       
       // Si estamos acelerando, generamos un trail debajo de la nave (parte trasera)
       if (keys.ArrowUp) {
           const cos = Math.cos(car.angle);
           const sin = Math.sin(car.angle);
           // Parte trasera central de la central donde se unen los reactores
           const backX = car.x - cos * (car.width / 4);
           const backY = car.y - sin * (car.width / 4);
           
           // Generamos una sola marca con la orientación exacta (menos partículas)
           if (Math.random() > 0.4) {
               thrusterTrail.push({
                   x: backX,
                   y: backY,
                   angle: car.angle,
                   alpha: 1.0,
                   size: 5
               });
           }
       }
       
       // Update trail decay
       for (let i = thrusterTrail.length - 1; i >= 0; i--) {
           thrusterTrail[i].alpha -= 0.05;
           thrusterTrail[i].size *= 0.90; // Se afila rápidamente
           if (thrusterTrail[i].alpha <= 0) thrusterTrail.splice(i, 1);
       }

       if (car.speed > car.maxSpeed) {
           car.vx = (car.vx / car.speed) * car.maxSpeed;
           car.vy = (car.vy / car.speed) * car.maxSpeed;
           car.speed = car.maxSpeed;
       }

       if (car.speed < 0.05) { car.vx = 0; car.vy = 0; car.speed = 0; }

       car.x += car.vx;
       car.y += car.vy;

       // --- Colisiones contra el Muro ---
       const corners = getCarCorners(car);
       let collision = false;
       for (let i=0; i<corners.length; i++) {
         const p1 = corners[i];
         const p2 = corners[(i+1)%corners.length];
         for (let j=0; j<trackLines.length; j++) {
           if (linesIntersect(p1, p2, trackLines[j].a, trackLines[j].b)) {
             collision = true; break;
           }
         }
         if (collision) break;
       }
       if (collision) {
         car.vx = -car.vx * 0.6; car.vy = -car.vy * 0.6;
         car.x += car.vx * 1.5; car.y += car.vy * 1.5;
         car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
       }

       // --- Lap Time Tracker ---
       // El coche debe cruzar el lado derecho de la pista (x > 3200) en su recorrido para evitar hacer trampa en la línea de meta.
       if (car.x > 3200) checkpoints.halfTrack = true;
       // El coche cruza y=2500 hacia ARRIBA dentro del pasillo
       if (car.prevY >= 2500 && car.y < 2500 && car.x >= 800 && car.x <= 1200) {
           if (mode === "wait_start" && isSolo) {
               mode = "racing";
               startTime = Date.now();
               uiMessage = "";
               localLap = 1;
           } else if (mode === "racing" && checkpoints.halfTrack) {
               if (localLap < TOTAL_LAPS) {
                   localLap++;
                   checkpoints.halfTrack = false;
                   uiMessage = `¡VUELTA ${localLap}!`;
                   setTimeout(() => { if (uiMessage === `¡VUELTA ${localLap}!`) uiMessage = ""; }, 2000);
               } else {
                   mode = "finished";
                   lapTime = Date.now() - startTime;
                   localFinished = true;
                   
                   if (isSolo) winState = "solo";
                   else {
                       // Chequear si soy el primero en acabar de todos (solo comparo si algún remoto está finished true)
                       const someFinished = Object.values(remoteCars).some(c => c.finished);
                       winState = someFinished ? "lose" : "win";
                   }
               }
           }
       }

       // --- Broadcast de Red Mínimo 30FPS ---
       const now = Date.now();
       if (!isSolo && now - lastNetworkSync > 32) { // aprox 30 veces por segundo (~33ms)
           lastNetworkSync = now;
           const sMsg = { 
               type: 'state', id: myIdRef.current, x: car.x, y: car.y, angle: car.angle,
               lap: localLap, finished: localFinished, speed: car.speed
           };
           Array.from(connsRef.current.values()).forEach(c => {
               if (c.open) c.send(sMsg);
           });
       }

       // --- RENDERIZADO EN CANVAS ---
       // Fondo oscuro estático (base para el color de fuera de la pista)
       ctx.fillStyle = "#1e1e24"; ctx.fillRect(0, 0, canvas.width, canvas.height); 
       
       ctx.save();
       
       // Cámara dinámica focalizada en el coche local
       const camX = car.x - canvas.width / 2;
       const camY = car.y - canvas.height / 2;
       ctx.translate(-camX, -camY);

       // Dibujar Decoraciones
       const screenPad = 200; // Solo dibujar lo que está medianamente cerca de la pantalla para optimizar
       for (const dec of mapDecorations) {
           if (dec.x < camX - screenPad || dec.x > camX + canvas.width + screenPad ||
               dec.y < camY - screenPad || dec.y > camY + canvas.height + screenPad) {
               continue;
           }

           ctx.save();
           ctx.translate(dec.x, dec.y);
           ctx.rotate(dec.angle);
           ctx.strokeStyle = dec.color;
           ctx.lineWidth = dec.thickness;
           ctx.beginPath();
           
           if (dec.type === 'circle') {
               ctx.arc(0, 0, dec.size / 2, 0, Math.PI * 2);
           } else if (dec.type === 'ring') {
               ctx.arc(0, 0, dec.size / 2, 0, Math.PI * 2);
               ctx.stroke();
               ctx.beginPath();
               ctx.arc(0, 0, dec.size / 3, 0, Math.PI * 2);
           } else if (dec.type === 'square') {
               ctx.rect(-dec.size / 2, -dec.size / 2, dec.size, dec.size);
           } else if (dec.type === 'cross') {
               ctx.moveTo(-dec.size / 2, 0); ctx.lineTo(dec.size / 2, 0);
               ctx.moveTo(0, -dec.size / 2); ctx.lineTo(0, dec.size / 2);
           } else if (dec.type === 'triangle') {
               ctx.moveTo(0, -dec.size / 2);
               ctx.lineTo(dec.size / 2, dec.size / 2);
               ctx.lineTo(-dec.size / 2, dec.size / 2);
               ctx.closePath();
           }
           
           ctx.stroke();
           ctx.restore();
       }

       // Pista: usamos fill "evenodd" con dos contornos (outer e inner) para no sobreescribir el interior
       ctx.beginPath(); 
       ctx.moveTo(trackOuter[0].x, trackOuter[0].y);
       for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y);
       ctx.closePath();
       
       ctx.moveTo(trackInner[0].x, trackInner[0].y);
       for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y);
       ctx.closePath();

       ctx.fillStyle = trackPattern; 
       ctx.fill("evenodd");

       // Dibujar Bordes Geométricos
       ctx.strokeStyle = "#44444c"; ctx.lineWidth = 4; ctx.lineJoin = "round";
       
       ctx.beginPath();
       ctx.moveTo(trackOuter[0].x, trackOuter[0].y);
       for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y);
       ctx.closePath(); ctx.stroke();
       
       ctx.beginPath();
       ctx.moveTo(trackInner[0].x, trackInner[0].y);
       for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y);
       ctx.closePath(); ctx.stroke();

       // Meta y Start point
       ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 12;
       ctx.beginPath(); ctx.moveTo(finishLine.x1, finishLine.y1); ctx.lineTo(finishLine.x2, finishLine.y2); ctx.stroke();

       // Trail de Propulsor Triangular Geométrico
       for (let i = 0; i < thrusterTrail.length; i++) {
           const mark = thrusterTrail[i];
           ctx.fillStyle = `rgba(0, 200, 255, ${mark.alpha})`; // Cyan brillante
           ctx.shadowBlur = mark.alpha * 15;
           ctx.shadowColor = "rgba(0, 200, 255, 1)";
           
           ctx.save();
           ctx.translate(mark.x, mark.y);
           ctx.rotate(mark.angle);
           
           // Dibujar un triángulo estilizado hacia atrás
           ctx.beginPath();
           ctx.moveTo(-mark.size * 3, 0); // Largo pico hacia atrás
           ctx.lineTo(0, mark.size);      // Extremo superior de la base
           ctx.lineTo(0, -mark.size);     // Extremo inferior de la base
           ctx.closePath();
           ctx.fill();
           
           ctx.restore();
       }
       ctx.shadowBlur = 0;

       // Helper genérico para coches/naves
       const drawCar = (c: any) => {
           ctx.save();
           ctx.translate(c.x, c.y);
           ctx.rotate(c.angle);
           
           // Cuerpo principal (Nave angular)
           ctx.beginPath();
           ctx.moveTo(c.width / 2 + 4, 0); // Pico delantero
           ctx.lineTo(-c.width / 2, c.height / 2 + 2); // Ala derecha
           ctx.lineTo(-c.width / 4, 0); // Cola central
           ctx.lineTo(-c.width / 2, -c.height / 2 - 2); // Ala izquierda
           ctx.closePath();
           
           ctx.fillStyle = '#1c1c20'; // Chasis oscuro
           ctx.fill();
           
           // Borde brillante con el color del equipo
           ctx.lineWidth = 1.5;
           ctx.strokeStyle = c.color;
           ctx.shadowBlur = 10;
           ctx.shadowColor = c.color;
           ctx.stroke();

           // Cabina central translúcida
           ctx.beginPath();
           ctx.moveTo(c.width / 4, 0);
           ctx.lineTo(-c.width / 6, c.height / 4);
           ctx.lineTo(-c.width / 6 + 2, 0);
           ctx.lineTo(-c.width / 6, -c.height / 4);
           ctx.closePath();
           ctx.fillStyle = 'rgba(0, 255, 255, 0.4)';
           ctx.shadowBlur = 0;
           ctx.fill();

           // Reactores de propulsión traseros (Vector)
           if (c.speed > 0.1) {
               ctx.strokeStyle = c.color;
               ctx.shadowBlur = 5; // Reducido para evitar mancha
               ctx.shadowColor = c.color;
               ctx.lineWidth = 2;
               ctx.beginPath();
               ctx.moveTo(-c.width / 4, 0); 
               ctx.lineTo(-c.width / 4 - (c.speed * 1.5), 0);
               ctx.stroke();
               ctx.shadowBlur = 0; // Reset estricto
           }

           ctx.restore();
       }

       // Pintamos primero a los rivales (por debajo en colisión visual), luego a nosotros mismos
       if (!isSolo) {
           Object.values(remoteCars).forEach(c => drawCar(c));
       }
       drawCar(car);

       ctx.restore(); // Finaliza el área afectada por la cámara

       // Controles UI de Cronómetro (Estáticos en pantalla)
       ctx.fillStyle = "#e0e0e0"; ctx.font = "bold 24px monospace";
       ctx.textAlign = "left";
       ctx.shadowColor = "#000"; ctx.shadowBlur = 2; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
       const elapsed = mode === "wait_start" ? 0 : (mode === "finished" ? lapTime : Date.now() - startTime);
       const ms = Math.floor((elapsed % 1000) / 10).toString().padStart(2, '0');
       const sec = Math.floor((elapsed / 1000) % 60).toString().padStart(2, '0');
       const min = Math.floor(elapsed / 60000).toString().padStart(2, '0');
       ctx.fillText(`${min}:${sec}.${ms}`, 20, 35);
       
       // Draw Laps
       ctx.textAlign = "right";
       ctx.fillStyle = car.color;
       ctx.fillText(`VUELTA: ${Math.min(localLap, TOTAL_LAPS)}/${TOTAL_LAPS}`, canvas.width - 20, 35);
       
       if (!isSolo) {
           ctx.fillStyle = "#888888"; 
           ctx.font = "bold 16px monospace";
           let yOffset = 60;
           Object.entries(remoteCars).forEach(([id, rcar]) => {
                ctx.fillStyle = rcar.color;
                ctx.fillText(`RIVAL: ${Math.min(rcar.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`, canvas.width - 20, yOffset);
                yOffset += 20;
           });
       }
       ctx.textAlign = "left";

       if (mode === "finished") {
           if (winState === "win") uiMessage = "¡HAS GANADO!";
           else if (winState === "lose") uiMessage = "¡HAS PERDIDO!";
           else uiMessage = "¡TIEMPO FINAL!";
       }
       
       if (uiMessage) {
           ctx.font = "900 48px sans-serif"; ctx.textAlign = "center";
           if (uiMessage === "¡HAS PERDIDO!") {
               ctx.fillStyle = "#ef4444"; ctx.shadowColor = "rgba(239,68,68,0.5)";
           } else if (uiMessage === "¡HAS GANADO!") {
               ctx.fillStyle = "#eab308"; ctx.shadowColor = "rgba(234,179,8,0.5)";
           } else {
               ctx.fillStyle = "#00ff00"; ctx.shadowColor = "rgba(0,255,0,0.5)";
           }
           ctx.shadowBlur = 20;
           ctx.fillText(uiMessage.toUpperCase(), canvas.width / 2, canvas.height / 2);
           
           if (mode === "finished") {
               ctx.font = "bold 24px sans-serif";
               ctx.fillStyle = "#e0e0e0"; ctx.shadowBlur = 4; ctx.shadowColor = "#000";
               ctx.fillText(`Tiempo total: ${(lapTime / 1000).toFixed(2)}s`, canvas.width / 2, canvas.height / 2 + 50);
               ctx.font = "16px sans-serif";
               ctx.fillText("Presiona ESPACIO para jugar de nuevo", canvas.width / 2, canvas.height / 2 + 90);
           }

           ctx.textAlign = "left"; ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
       }

       animationFrameId = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationFrameId);
      handleDataRef.current = null;
    };
  }, [view, isSolo]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen overflow-hidden m-0 p-0" style={{ backgroundColor: '#0f0f12', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        
        <h1 className="text-3xl font-bold mb-4 tracking-tight drop-shadow-md" style={{ color: '#e0e0e0' }}>Microspeed Online</h1>
        
        {/* Gestor simple de Alertas/Errores sin dañar IFrame */}
        {errorMsg && (
            <div className="absolute top-10 px-6 py-3 rounded bg-red-600 font-bold text-white shadow-[0_0_20px_rgba(220,38,38,0.5)] max-w-lg text-center pointer-events-none transition-all" style={{ zIndex: 50 }}>
                {errorMsg}
            </div>
        )}

        <div className="relative rounded flex flex-col items-center bg-[#1a1a1e]" style={{ width: 1024, height: 768, boxShadow: '0 0 50px rgba(0,0,0,0.5), 0 0 2px #f27d26', borderRadius: '4px', overflow: 'hidden' }}>
            
            {view === 'playing' ? (
                <canvas ref={canvasRef} width={1024} height={768} className="block" style={{ backgroundColor: '#1a1a1e' }} />
            ) : (
                <div className="flex flex-col items-center justify-center w-full h-full text-[#e0e0e0]">
                    <h2 className="text-3xl font-bold mb-10 tracking-widest text-[#f27d26]">SELECCIONA MODO</h2>
                    
                    {view === 'lobby' && (
                        <div className="flex flex-col gap-5">
                            <button onClick={startSolo} className="w-72 px-6 py-4 bg-[#f27d26] hover:bg-orange-600 text-white text-lg font-bold rounded shadow-lg transition transform hover:scale-105">
                                Contrarreloj (1 Jugador)
                            </button>
                            <button onClick={createRoom} className="w-72 px-6 py-4 bg-[#44444c] hover:bg-gray-600 text-white text-lg font-bold rounded shadow-lg transition transform hover:scale-105">
                                Crear Sala (7 Jugadores)
                            </button>
                            <button onClick={() => setView('joining')} className="w-72 px-6 py-4 bg-transparent border-2 border-[#44444c] hover:bg-[#44444c] text-white text-lg font-bold rounded shadow-lg transition transform hover:scale-105">
                                Unirse a Sala (7 Jugadores)
                            </button>
                        </div>
                    )}

                    {view === 'creating' && (
                        <div className="text-center flex flex-col items-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#f27d26] mb-6"></div>
                            <p className="text-xl text-gray-400">Esperando a otro jugador...</p>
                            <p className="text-5xl font-black text-[#f27d26] mt-4 tracking-widest">{roomId || '...'}</p>
                            <button onClick={() => setView('lobby')} className="mt-12 px-6 py-2 border-2 border-[#44444c] text-sm font-bold rounded hover:bg-[#44444c] transition">Cancerlar Servidor</button>
                        </div>
                    )}

                    {view === 'joining' && (
                        <div className="flex flex-col gap-6 items-center">
                            <input 
                                type="text" 
                                value={joinId} 
                                onChange={e => setJoinId(e.target.value.toUpperCase())} 
                                placeholder="ID DE SALA (CAR-XXX)" 
                                className="w-72 text-center px-4 py-4 text-2xl bg-[#2c2c34] text-[#e0e0e0] font-bold rounded border-2 border-[#44444c] focus:border-[#f27d26] outline-none uppercase transition" 
                            />
                            <div className="flex gap-4 w-full mt-2">
                                <button onClick={() => setView('lobby')} className="flex-1 px-4 py-3 bg-transparent border-2 border-[#44444c] hover:bg-[#44444c] text-[#e0e0e0] font-bold rounded transition">Atrás</button>
                                <button onClick={joinRoom} className="flex-1 px-4 py-3 bg-[#f27d26] hover:bg-orange-600 text-white font-bold rounded shadow-lg transition">Conectar</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>

        {view === 'playing' && (
            <p className="mt-5 flex space-x-6 uppercase tracking-[1px] text-[12px]" style={{ color: '#666' }}>
               <span><b className="px-1" style={{ color: '#f27d26' }}>↑ / ↓</b> Acelerar/Frenar</span>
               <span><b className="px-1" style={{ color: '#f27d26' }}>← / →</b> Girar</span>
               <span><b className="px-1" style={{ color: '#f27d26' }}>Space</b> Reiniciar Sprint (Local)</span>
            </p>
        )}
    </div>
  );
}
