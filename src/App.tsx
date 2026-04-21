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
  {x: 2400, y: 900},  // Tight left (FIXED: moved up to widen the 54-degree inner spike)
  {x: 2000, y: 500},  // Long diagonal straight
  {x: 1200, y: 300},  // Diagonal End
  {x: 500, y: 500},   // Hard left
  {x: 300, y: 1500},  // Carousel start
  {x: 300, y: 2500},  // Carousel mid
  {x: 600, y: 3200}   // Carousel exit to straight
];

const roundedCenter = createRoundedTrack(centerPath, 500);
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

const VirtualJoystick = ({ onMove, onRelease }: { onMove: (x: number, y: number) => void, onRelease: () => void }) => {
    const baseRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);
    
    const handlePointerDown = (e: React.PointerEvent) => {
        setActive(true);
        updateJoystick(e);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!active) return;
        updateJoystick(e);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setActive(false);
        if (stickRef.current) {
            stickRef.current.style.transform = `translate(0px, 0px)`;
        }
        onRelease();
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    };

    const updateJoystick = (e: React.PointerEvent) => {
        if (!baseRef.current || !stickRef.current) return;
        const rect = baseRef.current.getBoundingClientRect();
        const baseCenterX = rect.left + rect.width / 2;
        const baseCenterY = rect.top + rect.height / 2;
        
        let dx = e.clientX - baseCenterX;
        let dy = e.clientY - baseCenterY;
        
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDist = rect.width / 2;
        
        if (distance > maxDist) {
            dx = (dx / distance) * maxDist;
            dy = (dy / distance) * maxDist;
        }
        
        stickRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / maxDist, dy / maxDist);
    };

    return (
        <div 
            ref={baseRef}
            className="w-32 h-32 rounded-full border-2 border-zinc-500/30 bg-zinc-900/40 backdrop-blur-md flex items-center justify-center pointer-events-auto touch-none shadow-[0_0_20px_rgba(0,243,255,0.1)]"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <div 
                ref={stickRef}
                className="w-12 h-12 rounded-full bg-[#00f3ff] shadow-[0_0_15px_rgba(0,243,255,0.6)] pointer-events-none transition-transform duration-75"
                style={{ transform: 'translate(0px, 0px)' }}
            />
        </div>
    );
};

export default function App() {
  const [view, setView] = useState<'lobby' | 'creating' | 'joining' | 'room_lobby' | 'playing'>('lobby');
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [roomId, setRoomId] = useState('');
  const [joinId, setJoinId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSolo, setIsSolo] = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState<string[]>([]);
  const [playerName, setPlayerName] = useState(() => `Piloto-${Math.floor(Math.random() * 9000 + 1000)}`);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  
  const playerNameRef = useRef(playerName);
  const playerNamesRef = useRef<Record<string, string>>({});
  
  // Sincronizar estado con ref
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);  
  const peerRef = useRef<Peer | null>(null);
  const connsRef = useRef<Map<string, DataConnection>>(new Map());
  const isHost = useRef<boolean>(false);
  const myIdRef = useRef<string>('');
  const handleDataRef = useRef<((data: any, conn: DataConnection) => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const touchKeysRef = useRef<Record<string, any>>({ ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, joyX: 0, joyY: 0, joyActive: false });
  
  // Estado de juego persistente para evitar resets al redimensionar
  const gameStateRef = useRef<any>(null);

  // Limpiar error automáticamente tras unos segundos
  useEffect(() => {
     if (errorMsg) {
        const t = setTimeout(() => setErrorMsg(''), 5000);
        return () => clearTimeout(t);
     }
  }, [errorMsg]);

  // Manejar redimensionamiento
  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    const id = `CAR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`; // Ej. CAR-A1B2C3
    
    // Depender de los servidores STUN por defecto de PeerJS para mejorar compatibilidad con WebRTC NAT
    const peer = new Peer(id);
    
    peer.on('open', (assignedId) => {
      setRoomId(assignedId);
      myIdRef.current = assignedId;
      setLobbyPlayers([assignedId]);
      
      // Host asigna su propio nombre
      playerNamesRef.current[assignedId] = playerNameRef.current;
      setPlayerNames({...playerNamesRef.current});
      
      setView('room_lobby');
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
    setIsConnecting(true);
    setErrorMsg('');
    
    let connectionTimeout: any = null;

    // Conectar usando el servidor de señales por defecto
    const peer = new Peer();
    
    peer.on('open', (id) => {
      myIdRef.current = id;
      // Usar canales no fiables pero veloces (estándar juego online). No forzamos reliable: true.
      const conn = peer.connect(joinId);
      
      // Fallback timeout in case WebRTC negotiation hangs indefinitely
      connectionTimeout = setTimeout(() => {
          setIsConnecting(false);
          setErrorMsg("Tiempo de espera agotado. Asegúrate de que el Host sigue activo y usad redes compatibles.");
          setView('lobby');
          peer.destroy();
      }, 15000);
      
      conn.on('open', () => clearTimeout(connectionTimeout));
      
      connsRef.current.set(conn.peer, conn);
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      setIsConnecting(false);
      setErrorMsg(`Error al unirse (${err.type}): ${err.message}`);
      setView('lobby');
    });

    peerRef.current = peer;
    isHost.current = false;
  };

  const setupConnection = (conn: DataConnection) => {
    const syncLobby = () => {
        const currentList = [myIdRef.current, ...Array.from(connsRef.current.keys())];
        setLobbyPlayers(currentList);
        const msg = { type: 'lobby_sync', players: currentList, names: playerNamesRef.current };
        Array.from(connsRef.current.values()).forEach((c: any) => {
            if (c.open) c.send(msg);
        });
    };

    conn.on('open', () => {
      // Cliente envía su nombre al anfitrión
      conn.send({ type: 'hello', name: playerNameRef.current });

      if (isHost.current) {
         syncLobby();
      }
      setView(v => {
          if (v === 'joining') {
              setIsConnecting(false);
              return 'room_lobby';
          }
          return v;
      });
    });
    conn.on('data', (data: any) => {
      if (data.type === 'hello' && isHost.current) {
          // El anfitrión registra el nombre del nuevo jugador y reemite a todos
          playerNamesRef.current[conn.peer] = data.name;
          setPlayerNames({...playerNamesRef.current});
          syncLobby();
      } else if (data.type === 'lobby_sync') {
          setLobbyPlayers(data.players);
          setPlayerNames(data.names);
          playerNamesRef.current = data.names;
      } else if (data.type === 'start_race') {
          setView('playing');
      } else if (handleDataRef.current) {
          handleDataRef.current(data, conn);
      }
    });
    conn.on('close', () => {
      if (!isHost.current) {
          setErrorMsg("El anfitrión se ha desconectado.");
          setView('lobby');
      } else {
          connsRef.current.delete(conn.peer);
          delete playerNamesRef.current[conn.peer];
          setPlayerNames({...playerNamesRef.current});
          syncLobby();
      }
    });
    conn.on('error', (err) => {
      if (!isHost.current) {
          setIsConnecting(false);
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
    
    // Ajustar resolución del canvas al tamaño real de la ventana
    canvas.width = windowSize.width;
    canvas.height = windowSize.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Inicializar o recuperar estado del juego
    if (!gameStateRef.current) {
        gameStateRef.current = {
            car: {
                x: isSolo ? 1000 : (isHost.current ? 950 : 1050),
                y: 2800,
                prevX: isSolo ? 1000 : (isHost.current ? 950 : 1050),
                prevY: 2800,
                width: 20, height: 10,
                angle: -Math.PI / 2,
                prevAngle: -Math.PI / 2,
                vx: 0, vy: 0,
                speed: 0, maxSpeed: 8.5, acceleration: 0.14,
                friction: 0.988, lateralFriction: 0.975, rotationSpeed: 0.055,
                color: isSolo ? '#f27d26' : (isHost.current ? '#ef4444' : '#3b82f6'),
                trail: []
            },
            remoteCars: {},
            localLap: 1,
            localFinished: false,
            winState: "",
            mode: isSolo ? "wait_start" : "racing",
            startTime: Date.now(),
            lapTime: 0,
            uiMessage: isSolo ? "Acelera ↑ para cruzar la meta" : "",
            checkpoints: { halfTrack: false }
        };
    }

    const gs = gameStateRef.current;
    const TOTAL_LAPS = 3;

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

    // Función para resetear completamente el estado de carrera
    const resetRace = () => {
        gs.mode = isSolo ? "wait_start" : "racing";
        gs.startTime = Date.now();
        gs.lapTime = 0;
        gs.uiMessage = isSolo ? "Acelera ↑ para cruzar la meta" : "";
        gs.checkpoints.halfTrack = false;
        gs.localLap = 1;
        gs.localFinished = false;
        gs.winState = "";
        
        Object.values(gs.remoteCars).forEach((c: any) => {
            c.lap = 1;
            c.finished = false;
            c.speed = 0;
            c.trail = [];
        });
        
        gs.car.x = isSolo ? 1000 : (isHost.current ? 950 : 1050 + (Math.random() * 50 - 25));
        gs.car.y = 2800;
        gs.car.prevX = gs.car.x; gs.car.prevY = gs.car.y;
        gs.car.vx = 0; gs.car.vy = 0; gs.car.speed = 0;
        gs.car.angle = -Math.PI / 2;
        gs.car.prevAngle = gs.car.angle;
        gs.car.trail = [];
    };

    // Escuchar actualizaciones del oponente por red
    handleDataRef.current = (data: any, sourceConn: DataConnection) => {
      if (data.type === 'state') {
        const id = data.id;
        if (!gs.remoteCars[id]) {
            const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e'];
            let hash = 0; for(let i=0; i<id.length; i++) hash += id.charCodeAt(i);
            const rColor = colors[hash % colors.length];
            gs.remoteCars[id] = { x: data.x, y: data.y, angle: data.angle, width: 20, height: 10, color: rColor, lap: data.lap, finished: data.finished, speed: data.speed, trail: [] };
        }
        gs.remoteCars[id].x = data.x;
        gs.remoteCars[id].y = data.y;
        gs.remoteCars[id].angle = data.angle;
        gs.remoteCars[id].lap = data.lap;
        gs.remoteCars[id].finished = data.finished;
        gs.remoteCars[id].speed = data.speed;
        
        // Actualizar estela del oponente
        const rCos = Math.cos(data.angle);
        const rSin = Math.sin(data.angle);
        gs.remoteCars[id].trail.push({ x: data.x - rCos * 10, y: data.y - rSin * 10 });
        if (gs.remoteCars[id].trail.length > 50) gs.remoteCars[id].trail.shift();

        // Si soy host, reenvío esto al resto de clientes
        if (isHost.current) {
            Array.from(connsRef.current.values()).forEach((c: any) => {
               if (c.peer !== sourceConn.peer && c.open) c.send(data);
            });
        }

      } else if (data.type === 'restart') {
        resetRace();
        // Host forwards restart
        if (isHost.current) {
            Array.from(connsRef.current.values()).forEach((c: any) => {
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
      if (e.key === " " && gs.mode === "finished") {
          resetRace();
          if (!isSolo) {
              const rMsg = { type: 'restart' };
              Array.from(connsRef.current.values()).forEach((c: any) => { if (c.open) c.send(rMsg); });
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
       // --- Soporte Móvil y Gamepad ---
       let gpUp = false, gpDown = false, gpLeft = false, gpRight = false;
       const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
       const gp = gamepads[0];
       if (gp) {
           // D-pad (12: up, 13: down, 14: left, 15: right)
           if (gp.buttons[12]?.pressed) gpUp = true;
           if (gp.buttons[13]?.pressed) gpDown = true;
           if (gp.buttons[14]?.pressed) gpLeft = true;
           if (gp.buttons[15]?.pressed) gpRight = true;
           
           // Joystick Izquierdo (Axes 0: X, Axes 1: Y)
           if (gp.axes[1] < -0.3) gpUp = true;
           if (gp.axes[1] > 0.3) gpDown = true;
           if (gp.axes[0] < -0.3) gpLeft = true;
           if (gp.axes[0] > 0.3) gpRight = true;
           
           // Gatillos/Botones A/B
           if (gp.buttons[0]?.pressed || gp.buttons[7]?.pressed) gpUp = true; // A o R2 (Acelerar)
           if (gp.buttons[1]?.pressed || gp.buttons[6]?.pressed) gpDown = true; // B o L2 (Frenar)
           
           // Espacio/Restart -> Start (Boton 9)
           if (gp.buttons[9]?.pressed && gs.mode === "finished") {
               if (!gameStateRef.current.gamepadRestartLock) {
                   gameStateRef.current.gamepadRestartLock = true;
                   resetRace();
                   if (!isSolo) {
                       const rMsg = { type: 'restart' };
                       Array.from(connsRef.current.values()).forEach((c: any) => { if (c.open) c.send(rMsg); });
                   }
               }
           } else {
               gameStateRef.current.gamepadRestartLock = false;
           }
       }

       // --- Físicas (Sólo afecta a tu coche Local) ---
       const car = gs.car;
       car.prevX = car.x;
       car.prevY = car.y;
       car.prevAngle = car.angle;

       // Comportamiento estilo propulsor Flotante / Nave pura (Asteroids)
       if (keys.ArrowLeft || gpLeft || touchKeysRef.current.ArrowLeft) car.angle -= car.rotationSpeed;
       if (keys.ArrowRight || gpRight || touchKeysRef.current.ArrowRight) car.angle += car.rotationSpeed;

       // Móvil Joystick Omnidireccional (Estilo Asteroids moderno)
       if (touchKeysRef.current.joyActive) {
           const jx = touchKeysRef.current.joyX;
           const jy = touchKeysRef.current.joyY;
           const dist = Math.min(1, Math.hypot(jx, jy));
           
           if (dist > 0.1) {
               // Encontrar ángulo del joystick
               const targetAngle = Math.atan2(jy, jx);
               // Girar la nave rápidamente hacia el vector del joystick
               let diff = targetAngle - car.angle;
               diff = Math.atan2(Math.sin(diff), Math.cos(diff));
               car.angle += diff * 0.25; 
               
               // Acelerar automáticamente en esa dirección dependiendo de la presión (distancia central)
               car.vx += Math.cos(car.angle) * (car.acceleration * dist);
               car.vy += Math.sin(car.angle) * (car.acceleration * dist);
           }
       }

       // Aceleración y Frenado 2D Clásico
       if (keys.ArrowUp || gpUp || touchKeysRef.current.ArrowUp) { car.vx += Math.cos(car.angle) * car.acceleration; car.vy += Math.sin(car.angle) * car.acceleration; }
       // Frenar actúa como retropropulsor
       if (keys.ArrowDown || gpDown || touchKeysRef.current.ArrowDown) { car.vx -= Math.cos(car.angle) * (car.acceleration * 0.7); car.vy -= Math.sin(car.angle) * (car.acceleration * 0.7); }

       // Inercia global constante (La nave flota libremente en el espacio 2D)
       car.vx *= 0.985; 
       car.vy *= 0.985; 

       car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);

       if (car.speed > car.maxSpeed) {
           car.vx = (car.vx / car.speed) * car.maxSpeed;
           car.vy = (car.vy / car.speed) * car.maxSpeed;
           car.speed = car.maxSpeed;
       }
       if (car.speed < 0.05) { car.vx = 0; car.vy = 0; car.speed = 0; }
       
       car.x += car.vx;
       car.y += car.vy;

       // Actualizar estela local
       if (car.speed > 0.5) {
           const cos = Math.cos(car.angle);
           const sin = Math.sin(car.angle);
           // Añadir punto en la parte trasera de la nave
           gs.car.trail.push({ x: car.x - cos * 10, y: car.y - sin * 10 });
           if (gs.car.trail.length > 50) gs.car.trail.shift();
       } else if (gs.car.trail.length > 0) {
           gs.car.trail.shift(); // Desaparece si estoy parado
       }

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
         car.x = car.prevX;
         car.y = car.prevY;
         car.angle = car.prevAngle;
         car.vx = -car.vx * 0.6;
         car.vy = -car.vy * 0.6;
         car.speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
       }

       // --- Lógica de Carrera ---
       if (gs.mode === "wait_start") {
           if (car.speed > 0.5) {
               gs.mode = "racing";
               gs.startTime = Date.now();
               gs.uiMessage = "¡GO!";
               setTimeout(() => { if (gs.uiMessage === "¡GO!") gs.uiMessage = ""; }, 1000);
           }
       }

       if (gs.mode === "racing") {
           if (!gs.checkpoints.halfTrack && car.x > 3200) {
               gs.checkpoints.halfTrack = true;
           }

           if (car.prevY >= 2500 && car.y < 2500 && car.x >= 800 && car.x <= 1200) {
               if (!gs.checkpoints.halfTrack) {
                   gs.uiMessage = "¡FALTA MEDIA VUELTA!";
                   setTimeout(() => { if (gs.uiMessage === "¡FALTA MEDIA VUELTA!") gs.uiMessage = ""; }, 2000);
               } else {
                   if (gs.localLap < TOTAL_LAPS) {
                       gs.localLap++;
                       gs.checkpoints.halfTrack = false;
                       gs.uiMessage = `¡VUELTA ${gs.localLap}!`;
                       setTimeout(() => { if (gs.uiMessage === `¡VUELTA ${gs.localLap}!`) gs.uiMessage = ""; }, 2000);
                   } else {
                       gs.mode = "finished";
                       gs.lapTime = Date.now() - gs.startTime;
                       gs.localFinished = true;
                       
                       if (isSolo) gs.winState = "solo";
                       else {
                           const someFinished = Object.values(gs.remoteCars).some((c: any) => c.finished);
                           gs.winState = someFinished ? "lose" : "win";
                       }
                   }
               }
           }
       }

       // --- Broadcast de Red Mínimo 30FPS ---
       const now = Date.now();
       if (!isSolo && now - lastNetworkSync > 32) {
           lastNetworkSync = now;
           const sMsg = { 
               type: 'state', id: myIdRef.current, x: car.x, y: car.y, angle: car.angle,
               lap: gs.localLap, finished: gs.localFinished, speed: car.speed
           };
           Array.from(connsRef.current.values()).forEach((c: any) => {
               if (c.open) c.send(sMsg);
           });
       }

       // --- RENDERIZADO EN CANVAS ---
       ctx.fillStyle = "#1e1e24"; ctx.fillRect(0, 0, canvas.width, canvas.height); 
       
       const zoomFactor = windowSize.width < 768 ? 0.65 : 1.0;
       const viewW = canvas.width / zoomFactor;
       const viewH = canvas.height / zoomFactor;

       ctx.save();
       ctx.scale(zoomFactor, zoomFactor);

       const camX = car.x - viewW / 2;
       const camY = car.y - viewH / 2;
       ctx.translate(-camX, -camY);

       // Dibujar Decoraciones
       const screenPad = 200;
       for (const dec of mapDecorations) {
           if (dec.x < camX - screenPad || dec.x > camX + viewW + screenPad ||
               dec.y < camY - screenPad || dec.y > camY + viewH + screenPad) {
               continue;
           }
           ctx.save();
           ctx.translate(dec.x, dec.y); ctx.rotate(dec.angle); ctx.strokeStyle = dec.color; ctx.lineWidth = dec.thickness; ctx.beginPath();
           if (dec.type === 'circle') ctx.arc(0, 0, dec.size / 2, 0, Math.PI * 2);
           else if (dec.type === 'ring') { ctx.arc(0, 0, dec.size / 2, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, dec.size / 3, 0, Math.PI * 2); }
           else if (dec.type === 'square') ctx.rect(-dec.size / 2, -dec.size / 2, dec.size, dec.size);
           else if (dec.type === 'cross') { ctx.moveTo(-dec.size / 2, 0); ctx.lineTo(dec.size / 2, 0); ctx.moveTo(0, -dec.size / 2); ctx.lineTo(0, dec.size / 2); }
           else if (dec.type === 'triangle') { ctx.moveTo(0, -dec.size / 2); ctx.lineTo(dec.size / 2, dec.size / 2); ctx.lineTo(-dec.size / 2, dec.size / 2); ctx.closePath(); }
           ctx.stroke(); ctx.restore();
       }

       // Pista
       ctx.beginPath(); 
       ctx.moveTo(trackOuter[0].x, trackOuter[0].y); for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y); ctx.closePath();
       ctx.moveTo(trackInner[0].x, trackInner[0].y); for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y); ctx.closePath();
       ctx.fillStyle = trackPattern; ctx.fill("evenodd");

       // Bordes
       ctx.strokeStyle = "#44444c"; ctx.lineWidth = 4; ctx.lineJoin = "round";
       ctx.beginPath(); ctx.moveTo(trackOuter[0].x, trackOuter[0].y); for(let i=1; i<trackOuter.length; i++) ctx.lineTo(trackOuter[i].x, trackOuter[i].y); ctx.closePath(); ctx.stroke();
       ctx.beginPath(); ctx.moveTo(trackInner[0].x, trackInner[0].y); for(let i=1; i<trackInner.length; i++) ctx.lineTo(trackInner[i].x, trackInner[i].y); ctx.closePath(); ctx.stroke();
       ctx.strokeStyle = "#00ff00"; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(finishLine.x1, finishLine.y1); ctx.lineTo(finishLine.x2, finishLine.y2); ctx.stroke();

       // Dibujar Estelas (Trails)
       const drawTrail = (c: any) => {
           if (c.trail.length < 2) return;
           ctx.save();
           ctx.globalAlpha = 0.6;
           // Eliminado shadowBlur/Color para mejorar el rendimiento
           ctx.fillStyle = c.color;

           ctx.beginPath();
           
           const leftSide = [];
           const rightSide = [];
           
           for (let i = 0; i < c.trail.length; i++) {
               const p = c.trail[i];
               const progress = i / c.trail.length;
               const width = progress * 7; 
               
               let dx = 0, dy = 0;
               if (i === 0) {
                   dx = c.trail[1].x - c.trail[0].x;
                   dy = c.trail[1].y - c.trail[0].y;
               } else if (i === c.trail.length - 1) {
                   dx = c.trail[i].x - c.trail[i-1].x;
                   dy = c.trail[i].y - c.trail[i-1].y;
               } else {
                   dx = c.trail[i+1].x - c.trail[i-1].x;
                   dy = c.trail[i+1].y - c.trail[i-1].y;
               }
               
               const len = Math.sqrt(dx*dx + dy*dy) || 1;
               const nx = -dy / len;
               const ny = dx / len;
               
               leftSide.push({ x: p.x + nx * width, y: p.y + ny * width });
               rightSide.unshift({ x: p.x - nx * width, y: p.y - ny * width });
           }
           
           ctx.moveTo(leftSide[0].x, leftSide[0].y);
           for (let i = 1; i < leftSide.length; i++) {
               ctx.lineTo(leftSide[i].x, leftSide[i].y);
           }
           for (let i = 0; i < rightSide.length; i++) {
               ctx.lineTo(rightSide[i].x, rightSide[i].y);
           }
           
           ctx.closePath();
           ctx.fill();
           ctx.restore();
       }

       if (!isSolo) Object.values(gs.remoteCars).forEach(c => drawTrail(c));
       drawTrail(car);

       // Helper genérico para coches
       const drawCar = (c: any) => {
           ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.angle);
           ctx.beginPath(); ctx.moveTo(c.width / 2 + 4, 0); ctx.lineTo(-c.width / 2, c.height / 2 + 2); ctx.lineTo(-c.width / 4, 0); ctx.lineTo(-c.width / 2, -c.height / 2 - 2); ctx.closePath();
           ctx.fillStyle = '#1c1c20'; ctx.fill();
           ctx.lineWidth = 1.5; ctx.strokeStyle = c.color; ctx.stroke();
           ctx.beginPath(); ctx.moveTo(c.width / 4, 0); ctx.lineTo(-c.width / 6, c.height / 4); ctx.lineTo(-c.width / 6 + 2, 0); ctx.lineTo(-c.width / 6, -c.height / 4); ctx.closePath();
           ctx.fillStyle = 'rgba(0, 255, 255, 0.4)'; ctx.fill();
           if (c.speed > 0.1) {
           }
           ctx.restore();
       }

       if (!isSolo) Object.values(gs.remoteCars).forEach(c => drawCar(c));
       drawCar(car);
       ctx.restore();

       // UI
       const isMobile = windowSize.width < 768;
       ctx.fillStyle = "#e0e0e0"; ctx.font = isMobile ? "bold 20px monospace" : "bold 24px monospace"; ctx.textAlign = "left";
       const elapsed = gs.mode === "wait_start" ? 0 : (gs.mode === "finished" ? gs.lapTime : Date.now() - gs.startTime);
       const ms = Math.floor((elapsed % 1000) / 10).toString().padStart(2, '0');
       const sec = Math.floor((elapsed / 1000) % 60).toString().padStart(2, '0');
       const min = Math.floor(elapsed / 60000).toString().padStart(2, '0');
       ctx.fillText(`${min}:${sec}.${ms}`, 20, isMobile ? 30 : 35);
       
       ctx.textAlign = "right"; ctx.fillStyle = car.color;
       if (isMobile) {
           ctx.font = "bold 28px monospace";
           ctx.fillText(`${Math.min(gs.localLap, TOTAL_LAPS)}/${TOTAL_LAPS}`, canvas.width - 20, 35);
           ctx.font = "bold 12px monospace";
           ctx.fillText("VUELTA", canvas.width - 20, 58);
       } else {
           ctx.font = "bold 24px monospace";
           ctx.fillText(`VUELTA: ${Math.min(gs.localLap, TOTAL_LAPS)}/${TOTAL_LAPS}`, canvas.width - 20, 35);
       }
       if (!isSolo) {
           ctx.font = isMobile ? "bold 12px monospace" : "bold 16px monospace"; 
           let yOffset = isMobile ? 80 : 60;
           Object.entries(gs.remoteCars).forEach(([id, rcar]: [string, any]) => {
                const rawName = playerNamesRef.current[id] || "RIVAL";
                const dName = rawName.length > 10 ? rawName.substring(0, 10) + '...' : rawName;
                ctx.fillStyle = rcar.color; ctx.fillText(`${dName}: ${Math.min(rcar.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`, canvas.width - 20, yOffset); yOffset += isMobile ? 15 : 20;
           });
       }
       ctx.textAlign = "center";
       if (gs.mode === "finished") {
           if (gs.winState === "win") gs.uiMessage = "¡HAS GANADO!";
           else if (gs.winState === "lose") gs.uiMessage = "¡HAS PERDIDO!";
           else gs.uiMessage = "¡TIEMPO FINAL!";
       }
       if (gs.uiMessage) {
           ctx.font = "900 48px sans-serif"; ctx.fillStyle = (gs.uiMessage.includes("GANADO") || gs.uiMessage.includes("GO")) ? "#00ff00" : (gs.uiMessage.includes("PERDIDO") ? "#ef4444" : "#ffffff");
           // Eliminado shadowBlur para rendimiento
           ctx.fillText(gs.uiMessage.toUpperCase(), canvas.width / 2, canvas.height / 2);
           if (gs.mode === "finished") {
               ctx.font = "bold 24px sans-serif"; ctx.fillStyle = "#e0e0e0"; ctx.fillText(`Tiempo total: ${(gs.lapTime / 1000).toFixed(2)}s`, canvas.width / 2, canvas.height / 2 + 50);
               ctx.font = "16px sans-serif"; ctx.fillText("Presiona ESPACIO para jugar de nuevo", canvas.width / 2, canvas.height / 2 + 90);
           }
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
  }, [view, isSolo, windowSize]);

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen overflow-hidden m-0 p-0 font-sans" style={{ backgroundColor: '#09090b' }}>
        
        {view !== 'playing' && (
           <div className="absolute top-12 flex flex-col items-center z-10 pointer-events-none">
               <h1 className="text-4xl md:text-6xl font-black mb-1 tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] to-[#f27d26] uppercase drop-shadow-lg" style={{ fontFamily: 'Space Grotesk' }}>
                   Microspeed
               </h1>
               <div className="text-[#00f3ff] tracking-[0.5em] font-bold text-sm md:text-lg uppercase glow-text-cyan">Online</div>
           </div>
        )}
        
        {/* Gestor simple de Alertas/Errores sin dañar IFrame */}
        {errorMsg && (
            <div className="absolute top-32 px-6 py-3 hud-panel border border-red-500 font-mono font-bold text-red-400 shadow-[0_0_20px_rgba(220,38,38,0.5)] max-w-lg text-center pointer-events-none transition-all z-50">
                [ ERROR ]: {errorMsg}
            </div>
        )}

        <div className="relative w-full h-full flex flex-col items-center justify-center bg-grid-pattern overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-[#09090b]/80 to-[#09090b] pointer-events-none"></div>

            {view === 'playing' ? (
                <canvas ref={canvasRef} width={windowSize.width} height={windowSize.height} className="block w-full h-full relative z-0" style={{ backgroundColor: '#1a1a1e' }} />
            ) : (
                <div className="flex flex-col items-center justify-center w-full h-full text-zinc-100 z-10">
                    {view === 'lobby' && (
                        <div className="flex flex-col gap-5 mt-10">
                            <div className="w-[320px] flex flex-col mb-2">
                                <label className="text-[#00f3ff] text-xs font-mono tracking-widest mb-2 uppercase opacity-80">Identificación de Piloto</label>
                                <input 
                                    type="text" 
                                    className="bg-zinc-900/80 border border-[#00f3ff]/40 text-white font-mono px-4 py-3 outline-none focus:border-[#00f3ff] focus:shadow-[0_0_10px_rgba(0,243,255,0.3)] transition-all glow-text-cyan"
                                    value={playerName} 
                                    onChange={(e) => setPlayerName(e.target.value)}
                                    maxLength={15}
                                />
                            </div>
                            <button onClick={startSolo} className="btn-sci-fi w-[320px] px-6 py-5 bg-[#f27d26] text-white text-lg font-bold shadow-lg flex justify-between items-center group relative overflow-hidden">
                                <span className="relative z-10 tracking-widest uppercase">Contrarreloj</span>
                                <span className="relative z-10 font-mono text-sm text-black bg-white/80 px-2 py-1 rounded-sm">1P</span>
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                            </button>
                            <button onClick={createRoom} className="btn-sci-fi w-[320px] px-6 py-5 bg-[#00f3ff] text-black text-lg font-bold shadow-[0_0_15px_rgba(0,243,255,0.4)] flex justify-between items-center group relative overflow-hidden">
                                <span className="relative z-10 tracking-widest uppercase">Crear Sala</span>
                                <span className="relative z-10 font-mono text-sm text-black bg-white/80 px-2 py-1 rounded-sm">7P</span>
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-black/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>
                            </button>
                            <button onClick={() => setView('joining')} className="btn-sci-fi w-[320px] px-6 py-5 bg-transparent border-2 border-[#00f3ff] text-[#00f3ff] glow-border-cyan text-lg font-bold flex justify-between items-center hover:bg-[#00f3ff]/10">
                                <span className="relative z-10 tracking-widest uppercase">Unirse a Sala</span>
                                <span className="relative z-10 font-mono text-sm text-[#00f3ff] bg-[#00f3ff]/20 px-2 py-1 rounded-sm">7P</span>
                            </button>
                        </div>
                    )}

                    {view === 'creating' && (
                        <div className="text-center flex flex-col items-center hud-panel p-10 border border-[#f27d26]/50 shadow-[0_0_30px_rgba(242,125,38,0.2)]">
                            <div className="animate-spin rounded-none h-12 w-12 border-2 border-transparent border-t-[#f27d26] border-r-[#f27d26] mb-6"></div>
                            <p className="text-xl font-mono text-zinc-400 uppercase tracking-widest">Iniciando Servidor...</p>
                            <p className="text-2xl font-bold font-mono text-[#f27d26] mt-4 tracking-widest glow-text-orange">POR FAVOR ESPERA</p>
                        </div>
                    )}

                    {view === 'room_lobby' && (
                        <div className="flex flex-col items-center w-full max-w-lg hud-panel p-8 border border-[#00f3ff]/40 shadow-[0_0_40px_rgba(0,243,255,0.15)] mt-12">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#00f3ff] via-[#f27d26] to-[#00f3ff]"></div>
                            
                            <h2 className="text-sm font-mono mb-2 text-zinc-400 tracking-widest uppercase">ID de Enlace de Red</h2>
                            <h2 className="text-4xl font-black mb-8 tracking-widest text-[#00f3ff] glow-text-cyan font-mono">
                                {isHost.current ? roomId : joinId}
                            </h2>
                            
                            <div className="w-full mb-6">
                                <div className="flex justify-between items-end mb-2 border-b border-zinc-700 pb-2">
                                    <h3 className="text-sm tracking-widest font-bold text-zinc-300 uppercase">Pilotos en Red</h3>
                                    <span className="font-mono text-[#00f3ff] bg-[#00f3ff]/10 px-2 py-0.5 rounded text-sm">{lobbyPlayers.length} / 7</span>
                                </div>
                                <ul className="flex flex-col gap-2">
                                    {lobbyPlayers.map((p, i) => {
                                        const displayName = playerNames[p] || (p === myIdRef.current ? playerName : p);
                                        const isMe = p === myIdRef.current;
                                        return (
                                        <li key={i} className="flex justify-between items-center bg-zinc-900/80 border border-zinc-800 p-3 font-mono text-zinc-300 transition-colors hover:border-[#00f3ff]/50">
                                            <span className="flex items-center gap-3 truncate">
                                                <span className="w-2 h-2 rounded-full bg-[#00f3ff] glow-text-cyan animate-pulse shrink-0"></span>
                                                <span className="truncate">{displayName} {isMe ? (isHost.current ? '[HOST]' : '[YOU]') : ''}</span>
                                            </span>
                                            <span className="text-xs text-[#00f3ff]/80 font-bold uppercase tracking-wider backdrop-blur-sm bg-[#00f3ff]/10 px-2 py-1 shrink-0">En Línea</span>
                                        </li>
                                    )})}
                                    {[...Array(7 - lobbyPlayers.length)].map((_, i) => (
                                        <li key={'empty'+i} className="flex justify-between items-center bg-transparent border border-dashed border-zinc-800 p-3 text-zinc-600 font-mono italic">
                                            <span>&lt; ranura_vacía &gt;</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            
                            <div className="flex gap-4 w-full mt-4">
                                <button onClick={() => {
                                    peerRef.current?.destroy();
                                    setView('lobby');
                                }} className="btn-sci-fi flex-1 px-4 py-4 bg-transparent border-2 border-red-500/50 hover:bg-red-500/10 text-red-500 font-bold uppercase tracking-widest text-sm text-center">
                                    {isHost.current ? 'Abortar' : 'Desconectar'}
                                </button>
                                {isHost.current ? (
                                    <button 
                                        onClick={() => {
                                            const startMsg = { type: 'start_race' };
                                            Array.from(connsRef.current.values()).forEach((c: any) => { if (c.open) c.send(startMsg); });
                                            setView('playing');
                                        }} 
                                        disabled={lobbyPlayers.length < 1}
                                        className={`btn-sci-fi flex-1 px-4 py-4 bg-[#f27d26] hover:bg-orange-500 text-white font-bold uppercase tracking-widest text-sm text-center shadow-[0_0_15px_rgba(242,125,38,0.5)] ${lobbyPlayers.length < 1 ? 'opacity-30 cursor-not-allowed saturate-0' : ''}`}>
                                        Iniciar Secuencia
                                    </button>
                                ) : (
                                    <div className="btn-sci-fi flex-1 px-4 py-4 bg-zinc-800 text-zinc-500 text-center font-bold uppercase tracking-widest text-sm flex items-center justify-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-zinc-500 animate-ping"></div>
                                        Esperando Host
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {view === 'joining' && (
                        <div className="flex flex-col items-center w-full max-w-md hud-panel p-10 border border-[#00f3ff]/50 shadow-[0_0_30px_rgba(0,243,255,0.15)] mt-12">
                            <h2 className="text-2xl font-bold mb-8 tracking-widest text-zinc-100 uppercase">Conexión Remota</h2>
                            <div className="w-full relative">
                                <span className="absolute -top-3 left-3 bg-[#0f0f12] px-2 text-xs font-mono text-[#00f3ff] tracking-widest">ID DE ENLACE</span>
                                <input 
                                    type="text" 
                                    value={joinId} 
                                    onChange={e => setJoinId(e.target.value.toUpperCase().trim())} 
                                    placeholder="CAR-XXX" 
                                    className="w-full text-center px-4 py-5 text-3xl bg-black/40 text-[#00f3ff] font-mono font-bold border-2 border-zinc-700 outline-none uppercase transition focus:border-[#00f3ff] focus:shadow-[0_0_15px_rgba(0,243,255,0.3)] placeholder-zinc-700" 
                                />
                            </div>
                            <div className="flex gap-4 w-full mt-8">
                                <button onClick={() => setView('lobby')} className="btn-sci-fi flex-1 px-4 py-4 bg-transparent border-2 border-zinc-500 hover:border-zinc-300 hover:text-white text-zinc-400 font-bold uppercase tracking-widest text-sm">Cancelar</button>
                                <button onClick={joinRoom} disabled={isConnecting} className={`btn-sci-fi flex-1 px-4 py-4 bg-[#00f3ff] text-black font-bold shadow-[0_0_15px_rgba(0,243,255,0.4)] uppercase tracking-widest text-sm ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                    {isConnecting ? 'Conectando...' : 'Conectar'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>

        {view === 'playing' && (
            <>
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden md:flex gap-6 px-6 py-3 hud-panel border border-[#f27d26]/30 uppercase tracking-widest text-xs font-mono text-zinc-400 z-10 backdrop-blur-md">
                   <span className="flex items-center gap-2"><b className="text-[#f27d26] bg-[#f27d26]/10 px-1.5 py-0.5 rounded">↑ ↓</b> Acelerar/Frenar</span>
                   <span className="flex items-center gap-2"><b className="text-[#f27d26] bg-[#f27d26]/10 px-1.5 py-0.5 rounded">← →</b> Girar</span>
                   <span className="flex items-center gap-2"><b className="text-[#00f3ff] bg-[#00f3ff]/10 px-1.5 py-0.5 rounded">ESPACIO</b> Reiniciar (Local)</span>
                </div>
                
                {/* On-screen Touch Controls (Visible on mobile/tablets usually) */}
                <div className="md:hidden absolute inset-x-0 bottom-0 pointer-events-none flex justify-between p-8 z-20 touch-none items-end">
                    
                    {/* Joystick Virtual Omnidireccional (Apunta y Acelera estilo Asteroids) */}
                    <div className="pointer-events-auto">
                        <VirtualJoystick 
                           onMove={(x, y) => {
                               touchKeysRef.current.joyActive = true;
                               touchKeysRef.current.joyX = x;
                               touchKeysRef.current.joyY = y;
                           }}
                           onRelease={() => {
                               touchKeysRef.current.joyActive = false;
                           }} 
                        />
                    </div>
                    
                    <div className="flex gap-4 items-end pointer-events-none">
                        <button 
                           className="w-24 h-24 rounded-full bg-zinc-900/50 border-2 border-red-500/50 text-red-500 font-bold text-lg flex justify-center items-center pointer-events-auto active:bg-zinc-800/80 touch-none backdrop-blur-md shadow-[0_0_15px_rgba(220,38,38,0.3)] uppercase tracking-widest"
                           onPointerDown={(e) => { e.preventDefault(); touchKeysRef.current.ArrowDown = true; }}
                           onPointerUp={(e) => { e.preventDefault(); touchKeysRef.current.ArrowDown = false; }}
                           onPointerLeave={() => { touchKeysRef.current.ArrowDown = false; }}
                        >FRENO</button>
                    </div>
                </div>
            </>
        )}
    </div>
  );
}
