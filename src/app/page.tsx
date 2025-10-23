"use client";
import React, { useEffect, useRef, useState } from "react";

type Vec = { x: number; y: number };

type GameState = {
  gridSize: number;
  cell: number;
  snake: Vec[];
  dir: Vec;
  nextDir: Vec;
  food: Vec;
  score: number;
  tickMs: number;
  grace: number;
};

const EQ = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const DIRS: Record<string, Vec> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

const getDirForCode = (code: string): Vec | null => (code in DIRS ? DIRS[code] : null);

const randFood = (gridSize: number, snake: Vec[]): Vec => {
  while (true) {
    const f = { x: Math.floor(Math.random() * gridSize), y: Math.floor(Math.random() * gridSize) };
    if (!snake.some((s) => EQ(s, f))) return f;
  }
};

const opposite = (a: Vec, b: Vec) => a.x === -b.x && a.y === -b.y;

function useBestScore(key = "snake_best") {
  const [best, setBest] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) ? v : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(key, String(best));
  }, [best, key]);
  return { best, setBest };
}

export default function SnakePage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [{ score }, setScore] = useState({ score: 0 });
  const { best, setBest } = useBestScore();

  const stateRef = useRef<GameState | null>(null);
  const lastTsRef = useRef<number>(0);
  const accRef = useRef<number>(0);
  const gameOverAtRef = useRef<number | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const resizeCanvas = () => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const parent = cvs.parentElement;
    if (!parent) return;
    const target = parent.clientWidth;
    const gridSize = stateRef.current?.gridSize ?? 14;
    const cell = Math.max(8, Math.floor(target / gridSize));
    const cssSize = cell * gridSize;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    cvs.style.width = `${cssSize}px`;
    cvs.style.height = `${cssSize}px`;
    cvs.width = Math.floor(cssSize * dpr);
    cvs.height = Math.floor(cssSize * dpr);
    if (stateRef.current) stateRef.current.cell = cell;
  };

  const reset = () => {
    const gridSize = 14;
    const snake: Vec[] = [
      { x: Math.floor(gridSize / 2), y: Math.floor(gridSize / 2) },
      { x: Math.floor(gridSize / 2) - 1, y: Math.floor(gridSize / 2) },
    ];
    const dir = { x: 1, y: 0 };
    resizeCanvas();
    const cvs = canvasRef.current!;
    const cssSize = Math.min(cvs.clientWidth, cvs.clientHeight);
    const cell = Math.max(8, Math.floor(cssSize / gridSize));
    const food = randFood(gridSize, snake);
    stateRef.current = {
      gridSize,
      cell,
      snake,
      dir,
      nextDir: dir,
      food,
      score: 0,
      tickMs: 170,
      grace: 0,
    };
    setScore({ score: 0 });
    setGameOver(false);
    gameOverAtRef.current = null;
  };

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    reset();
    setRunning(true);
    return () => {
      window.removeEventListener("resize", onResize);
      if (restartTimeoutRef.current !== null) window.clearTimeout(restartTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = getDirForCode(e.code);
      if (!d) return;
      e.preventDefault();
      const st = stateRef.current;
      if (!st) return;
      if (!opposite(d, st.dir)) st.nextDir = d;
      st.grace = 250;
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      
      const touch = e.changedTouches[0];
      if (!touch) return;

      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      
      // Minimum swipe distance to register as a swipe
      const minSwipeDistance = 30;
      
      // Determine if it's more horizontal or vertical
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      
      if (Math.max(absX, absY) < minSwipeDistance) {
        touchStartRef.current = null;
        return;
      }

      let direction: Vec | null = null;
      
      if (absX > absY) {
        // Horizontal swipe
        direction = deltaX > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
      } else {
        // Vertical swipe
        direction = deltaY > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
      }

      if (direction) {
        const st = stateRef.current;
        if (st && !opposite(direction, st.dir)) {
          st.nextDir = direction;
          st.grace = 250;
        }
      }

      touchStartRef.current = null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Prevent scrolling while swiping on the game
      e.preventDefault();
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchmove", handleTouchMove);
    };
  }, []);

  useEffect(() => {
    if (!gameOver) return;
    if (restartTimeoutRef.current !== null) window.clearTimeout(restartTimeoutRef.current);
    restartTimeoutRef.current = window.setTimeout(() => {
      reset();
      setRunning(true);
    }, 2000);
  }, [gameOver]);

  useEffect(() => {
    let raf = 0;
    const step = (ts: number) => {
      const st = stateRef.current;
      if (!st) {
        raf = requestAnimationFrame(step);
        return;
      }
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = lastTsRef.current ? ts - lastTsRef.current : 0;
      lastTsRef.current = ts;
      if (running && !gameOver) {
        accRef.current += dt;
        st.grace = Math.max(0, st.grace - dt);
        while (accRef.current >= st.tickMs) {
          accRef.current -= st.tickMs;
          if (!opposite(st.nextDir, st.dir)) st.dir = st.nextDir;
          const newHead = add(st.snake[0], st.dir);
          const hitWall =
            newHead.x < 0 ||
            newHead.y < 0 ||
            newHead.x >= st.gridSize ||
            newHead.y >= st.gridSize;
          const hitSelf = st.snake.some((s) => EQ(s, newHead));
          if ((hitWall || hitSelf) && st.grace <= 0) {
            setGameOver(true);
            setRunning(false);
            setBest((b) => Math.max(b, st.score));
            gameOverAtRef.current = performance.now();
            break;
          } else if (hitWall || hitSelf) {
            st.grace = 0;
            break;
          }
          st.snake.unshift(newHead);
          if (EQ(newHead, st.food)) {
            st.score += 1;
            setScore({ score: st.score });
            st.food = randFood(st.gridSize, st.snake);
            st.tickMs = 170 - Math.floor((170 - 80) * Math.min(st.score, 30) / 30);
          } else {
            st.snake.pop();
          }
        }
      }
      draw(ctx, stateRef.current!, gameOver, gameOverAtRef.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, gameOver]);

  return (
    <div className="w-full h-full flex justify-center items-center bg-neutral-900">
      <div className="md:w-xl flex flex-col mt-[-1] justify-center select-none bg-neutral-900 text-white min-h-screen">
        <div className="flex items-center w-full justify-between mb-3 text-sm">
          <span className="mr-4">SCORE: <strong>{score}</strong></span>
          <span>BEST: <strong>{best}</strong></span>
        </div>
        <div className="overflow-hidden md:w-xl flex justify-center">
          <canvas ref={canvasRef} className="block w-full" />
        </div>
      </div>
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, st: GameState, gameOver: boolean, gameOverAt: number | null) {
  const { gridSize, cell, snake, food } = st;
  const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
  ctx.save();
  ctx.scale(dpr, dpr);
  const sizePx = gridSize * cell;
  ctx.clearRect(0, 0, sizePx, sizePx);
  ctx.fillStyle = "oklch(26.9% 0 0)";
  ctx.fillRect(0, 0, sizePx, sizePx);
  if (!gameOver) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, food.x * cell + 2, food.y * cell + 2, cell - 4, cell - 4, 6);
    ctx.fill();
  }
  const now = performance.now();
  snake.forEach((s, i) => {
    let scale = 1;
    if (gameOver && gameOverAt != null) {
      const elapsed = now - gameOverAt;
      const t = Math.max(0, Math.min(1, (elapsed - i * 60) / 300));
      scale = 1 - t;
    }
    const cx = s.x * cell + cell / 2;
    const cy = s.y * cell + cell / 2;
    const w = Math.max(0, cell - 3) * scale;
    const h = Math.max(0, cell - 3) * scale;
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.fillStyle = i === 0 ? "#22c55e" : "#16a34a";
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
  });
  if (gameOver) {
    const fs = Math.max(5, Math.floor(sizePx * 0.05));
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fs}px "Press Start 2P", monospace`;
    ctx.fillText("GAME OVER", sizePx / 2, sizePx / 2);
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
