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

const trackOuter = createRoundedTrack([
  {x: 80, y: 400}, {x: 80, y: 150}, {x: 150, y: 80}, {x: 350, y: 80},
  {x: 450, y: 200}, {x: 600, y: 200}, {x: 700, y: 80}, {x: 880, y: 80},
  {x: 960, y: 150}, {x: 960, y: 600}, {x: 880, y: 700}, {x: 650, y: 700},
  {x: 550, y: 550}, {x: 400, y: 550}, {x: 300, y: 700}, {x: 150, y: 700}
], 70);

const trackInner = createRoundedTrack([
  {x: 220, y: 400}, {x: 220, y: 220}, {x: 250, y: 220}, {x: 350, y: 340},
  {x: 700, y: 340}, {x: 820, y: 220}, {x: 820, y: 560}, {x: 750, y: 560},
  {x: 650, y: 410}, {x: 300, y: 410}, {x: 220, y: 560}
], 70);
const finishLine = { x1: 80, y1: 450, x2: 220, y2: 450 };

export default function App() {
  const [view, setView] = useState<'lobby' | 'creating' | 'joining' | 'playing'>('lobby');
  const [roomId, setRoomId] = useState('');
  const [joinId, setJoinId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSolo, setIsSolo] = useState(false);
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const isHost = useRef<boolean>(false);
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
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
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
    
    peer.on('open', () => {
      const conn = peer.connect(joinId);
      connRef.current = conn;
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
      setView('playing');
    });
    conn.on('close', () => {
      setErrorMsg("El oponente se ha desconectado.");
      setView('lobby');
    });
    conn.on('error', (err) => {
      setErrorMsg("Se perdió la conexión con el servidor.");
      setView('lobby');
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
      x: isSolo ? 150 : (isHost.current ? 120 : 180),
      y: 500,
      prevX: isSolo ? 150 : (isHost.current ? 120 : 180),
      prevY: 500,
      width: 20, height: 10,
      angle: -Math.PI / 2,
      vx: 0, vy: 0,
      speed: 0, maxSpeed: 7, acceleration: 0.18,
      friction: 0.988, lateralFriction: 0.85, rotationSpeed: 0.08,
      color: isSolo ? '#f27d26' : (isHost.current ? '#ef4444' : '#3b82f6') // Solo: Naranja. Host: Rojo. Guest: Azul
    };

    // Config Coche Remoto (Solo para Multi)
    let remoteCar = {
      x: isHost.current ? 180 : 120,
      y: 500,
      angle: -Math.PI / 2,
      width: 20, height: 10,
      color: isHost.current ? '#3b82f6' : '#ef4444'
    };

    let mode = isSolo ? "wait_start" : "racing";
    let startTime = Date.now();
    let lapTime = 0;
    let uiMessage = isSolo ? "Acelera ↑ para cruzar la meta" : "";
    let checkpoints = { halfTrack: false };

    // Escuchar actualizaciones del oponente por red
    const handleData = (data: any) => {
      if (data.type === 'state') {
        remoteCar.x = data.x;
        remoteCar.y = data.y;
        remoteCar.angle = data.angle;
      }
    };
    if (!isSolo && connRef.current) {
        connRef.current.on('data', handleData);
    }

    // Gestionar Teclado
    const keys: Record<string, boolean> = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key in keys) { keys[e.key] = true; e.preventDefault(); }
      
      // Reiniciar meta/tiempo local
      if (e.key === " " && mode === "finished") {
          mode = isSolo ? "wait_start" : "racing";
          startTime = Date.now();
          lapTime = 0;
          uiMessage = isSolo ? "Acelera ↑ para cruzar la meta" : "";
          checkpoints.halfTrack = false;
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

       // Aceleración y Frenado 2D
       if (keys.ArrowUp) { car.vx += Math.cos(car.angle) * car.acceleration; car.vy += Math.sin(car.angle) * car.acceleration; }
       if (keys.ArrowDown) { car.vx -= Math.cos(car.angle) * (car.acceleration * 0.7); car.vy -= Math.sin(car.angle) * (car.acceleration * 0.7); }

       let fVel = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
       let lVel = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);

       // Capacidad de giro dinámica (con simulación de subviraje)
       if (Math.abs(fVel) > 0.1) {
           const dir = fVel > 0 ? 1 : -1;
           const speedRatio = Math.abs(fVel) / car.maxSpeed;
           const turnPenalty = Math.max(0.25, 1.0 - (Math.pow(speedRatio, 1.2) * 0.8)); 
           const turnSpeed = (Math.abs(fVel) * 0.025) * turnPenalty;
           
           if (keys.ArrowLeft) car.angle -= turnSpeed * dir;
           if (keys.ArrowRight) car.angle += turnSpeed * dir;
       }

       fVel *= car.friction; 
       lVel *= car.lateralFriction; 

       car.vx = fVel * Math.cos(car.angle) - lVel * Math.sin(car.angle);
       car.vy = fVel * Math.sin(car.angle) + lVel * Math.cos(car.angle);

       car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
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
       // El coche debe cruzar el lado derecho de la pista (x > 800) en su recorrido para evitar hacer trampa en la línea de meta.
       if (car.x > 800) checkpoints.halfTrack = true;
       // El coche cruza y=450 hacia ARRIBA dentro del pasillo lateral izquierdo (x: 80 a 220)
       if (car.prevY >= 450 && car.y < 450 && car.x >= 50 && car.x <= 250) {
           if (mode === "wait_start" && isSolo) {
               mode = "racing";
               startTime = Date.now();
               uiMessage = "";
           } else if (mode === "racing" && checkpoints.halfTrack) {
               mode = "finished";
               lapTime = Date.now() - startTime;
               uiMessage = "Lap: " + (lapTime / 1000).toFixed(2) + "s";
           }
       }

       // --- Broadcast de Red Mínimo 30FPS ---
       const now = Date.now();
       if (!isSolo && now - lastNetworkSync > 32) { // aprox 30 veces por segundo (~33ms)
           lastNetworkSync = now;
           if (connRef.current && connRef.current.open) {
               connRef.current.send({ type: 'state', x: car.x, y: car.y, angle: car.angle });
           }
       }

       // --- RENDERIZADO EN CANVAS ---
       // Fondo oscuro
       ctx.fillStyle = "#44444c"; ctx.fillRect(0, 0, canvas.width, canvas.height); 
       
       // Área de carrera exterior
       ctx.beginPath(); 
       ctx.moveTo(trackOuter[0].x, trackOuter[0].y);
       for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y);
       ctx.closePath();
       ctx.fillStyle = "#2c2c34"; ctx.fill();

       // Isla interna a recortar
       ctx.beginPath(); 
       ctx.moveTo(trackInner[0].x, trackInner[0].y);
       for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y);
       ctx.closePath();
       ctx.fillStyle = "#44444c"; ctx.fill();

       // Dibujar Bordes Geométricos
       ctx.strokeStyle = "#44444c"; ctx.lineWidth = 1; ctx.lineJoin = "round";
       
       ctx.beginPath();
       ctx.moveTo(trackOuter[0].x, trackOuter[0].y);
       for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y);
       ctx.closePath(); ctx.stroke();
       
       ctx.beginPath();
       ctx.moveTo(trackInner[0].x, trackInner[0].y);
       for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y);
       ctx.closePath(); ctx.stroke();

       // Meta y Start point
       ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 8;
       ctx.beginPath(); ctx.moveTo(finishLine.x1, finishLine.y1); ctx.lineTo(finishLine.x2, finishLine.y2); ctx.stroke();

       // Helper genérico para coches
       const drawCar = (c: any) => {
           ctx.save();
           ctx.translate(c.x, c.y);
           ctx.rotate(c.angle);
           ctx.fillStyle = c.color;
           ctx.shadowBlur = 10;
           ctx.shadowColor = c.color;
           ctx.fillRect(-c.width/2, -c.height/2, c.width, c.height);
           // Luces del coche (blancas adelante)
           ctx.fillStyle = "#ffffff";
           ctx.shadowBlur = 0;
           ctx.fillRect(c.width/2 - 2, -c.height/2 + 1, 2, 2);
           ctx.fillRect(c.width/2 - 2, c.height/2 - 3, 2, 2);
           ctx.restore();
       }

       // Pintamos primero al rival (por debajo en colisión visual), luego a nosotros mismos
       if (!isSolo) drawCar(remoteCar); 
       drawCar(car);

       // Controles UI de Cronómetro
       ctx.fillStyle = "#e0e0e0"; ctx.font = "bold 24px monospace";
       ctx.shadowColor = "#000"; ctx.shadowBlur = 2; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
       const elapsed = mode === "wait_start" ? 0 : (mode === "finished" ? lapTime : Date.now() - startTime);
       const ms = Math.floor((elapsed % 1000) / 10).toString().padStart(2, '0');
       const sec = Math.floor((elapsed / 1000) % 60).toString().padStart(2, '0');
       const min = Math.floor(elapsed / 60000).toString().padStart(2, '0');
       ctx.fillText(`${min}:${sec}.${ms}`, 20, 35);
       
       if (uiMessage) {
           ctx.font = "900 48px sans-serif"; ctx.textAlign = "center";
           ctx.fillStyle = "#00ff00"; ctx.shadowColor = "rgba(0,255,0,0.5)"; ctx.shadowBlur = 20;
           ctx.fillText(uiMessage.toUpperCase(), canvas.width / 2, canvas.height / 2);
           ctx.textAlign = "left"; ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
       }

       animationFrameId = requestAnimationFrame(gameLoop);
    };

    gameLoop();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animationFrameId);
      if (connRef.current) connRef.current.off('data', handleData);
    };
  }, [view, isSolo]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen overflow-hidden m-0 p-0" style={{ backgroundColor: '#0f0f12', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        
        <h1 className="text-3xl font-bold mb-4 tracking-tight drop-shadow-md" style={{ color: '#e0e0e0' }}>Micro Machines Online</h1>
        
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
                                Crear Sala (2 Jugadores)
                            </button>
                            <button onClick={() => setView('joining')} className="w-72 px-6 py-4 bg-transparent border-2 border-[#44444c] hover:bg-[#44444c] text-white text-lg font-bold rounded shadow-lg transition transform hover:scale-105">
                                Unirse a Sala (2 Jugadores)
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
