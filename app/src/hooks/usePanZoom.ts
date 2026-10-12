/**
 * usePanZoom — the camera for the Aura Atlas.
 *
 * The camera is `{ x, y, z }`: the world point at the viewport centre plus the
 * scale. It is NOT React state — dragging writes `camRef` and only touches the
 * layer's `transform` inside a rAF, so a 60fps pan never re-renders the plots.
 * React state (`view`) is a throttled mirror for the chrome around the map
 * (minimap, zoom buttons); it is not on the pan's critical path.
 *
 * Handles the whole gesture vocabulary on the container: one-finger/mouse drag
 * pans with inertia, wheel zooms about the cursor, two-finger pinch zooms about
 * the midpoint, double-click zooms in, and `flyTo` eases the camera home for
 * "jump to a district / handle". `prefers-reduced-motion` turns inertia and
 * tweening into an instant jump.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clamp } from "@/lib/format";

export type Camera = { x: number; y: number; z: number };

export function usePanZoom({
  worldWidth,
  worldHeight,
  maxZoom = 1.8,
}: {
  worldWidth: number;
  worldHeight: number;
  maxZoom?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef<Camera>({ x: worldWidth / 2, y: worldHeight / 2, z: 0.35 });
  const viewportRef = useRef({ w: 1, h: 1 });
  const fitRef = useRef(0.35);
  const initedRef = useRef(false);
  const reducedRef = useRef(false);
  const rafRef = useRef(0);
  const commitAtRef = useRef(0);

  const [view, setView] = useState<Camera>(camRef.current);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const minZoom = useCallback(() => Math.max(0.02, fitRef.current * 0.8), []);

  /** Push `camRef` onto the layer's transform; mirror to state at most ~11fps. */
  const apply = useCallback((commit = false) => {
    const layer = layerRef.current;
    if (!layer) return;
    const { w, h } = viewportRef.current;
    const { x, y, z } = camRef.current;
    layer.style.transform = `translate3d(${w / 2 - x * z}px, ${h / 2 - y * z}px, 0) scale(${z})`;
    // Below a bit past "fit" the labels would be noise; hide them until zoomed.
    layer.dataset.zoom = z >= fitRef.current * 1.35 ? "in" : "out";
    const now = performance.now();
    if (commit || now - commitAtRef.current > 90) {
      commitAtRef.current = now;
      setView({ x, y, z });
    }
  }, []);

  const clampCam = useCallback(
    (cam: Camera): Camera => {
      const { w, h } = viewportRef.current;
      cam.z = clamp(cam.z, minZoom(), maxZoom);
      const halfW = w / (2 * cam.z);
      const halfH = h / (2 * cam.z);
      // Center on an axis where the world is narrower than the view.
      cam.x = halfW * 2 >= worldWidth ? worldWidth / 2 : clamp(cam.x, halfW, worldWidth - halfW);
      cam.y = halfH * 2 >= worldHeight ? worldHeight / 2 : clamp(cam.y, halfH, worldHeight - halfH);
      return cam;
    },
    [minZoom, maxZoom, worldWidth, worldHeight],
  );

  const stopAnim = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  /** Ease the camera to a world point. `z` defaults to the current scale. */
  const flyTo = useCallback(
    (x: number, y: number, z?: number, ms = 650) => {
      stopAnim();
      const from = { ...camRef.current };
      const to = clampCam({ x, y, z: z ?? camRef.current.z });
      if (reducedRef.current || ms <= 0) {
        camRef.current = to;
        apply(true);
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        camRef.current = {
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
          z: from.z + (to.z - from.z) * e,
        };
        apply();
        if (k < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = 0;
          apply(true);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [apply, clampCam, stopAnim],
  );

  /** Whole world, centred. */
  const fitAll = useCallback(
    (ms = 600) => flyTo(worldWidth / 2, worldHeight / 2, fitRef.current, ms),
    [flyTo, worldWidth, worldHeight],
  );

  /** Step the zoom about the viewport centre (the +/- buttons). */
  const zoomBy = useCallback(
    (factor: number) => {
      stopAnim();
      camRef.current = clampCam({ ...camRef.current, z: camRef.current.z * factor });
      apply(true);
    },
    [apply, clampCam, stopAnim],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    reducedRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      viewportRef.current = { w, h };
      setViewport({ w, h });
      fitRef.current = Math.min(w / worldWidth, h / worldHeight) || 0.35;
      if (!initedRef.current) {
        initedRef.current = true;
        camRef.current = { x: worldWidth / 2, y: worldHeight / 2, z: fitRef.current };
      } else {
        clampCam(camRef.current);
      }
      apply(true);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    // Gesture state lives in the effect closure: attached once, never re-run.
    const pointers = new Map<number, { x: number; y: number }>();
    let panStart: { sx: number; sy: number; cam: Camera } | null = null;
    let pinchStart: { dist: number; mid: { x: number; y: number }; cam: Camera } | null = null;
    let dragMoved = false;
    let suppressClick = false;
    let vel = { x: 0, y: 0 };
    let last = { x: 0, y: 0, t: 0 };

    const local = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    const zoomAt = (px: number, py: number, factor: number) => {
      const cam = camRef.current;
      const { w, h } = viewportRef.current;
      const wx = (px - w / 2) / cam.z + cam.x;
      const wy = (py - h / 2) / cam.z + cam.y;
      cam.z = clamp(cam.z * factor, minZoom(), maxZoom);
      cam.x = wx - (px - w / 2) / cam.z;
      cam.y = wy - (py - h / 2) / cam.z;
      clampCam(cam);
      apply();
    };

    const startInertia = () => {
      if (reducedRef.current) return;
      if (Math.hypot(vel.x, vel.y) < 0.05) return; // px/ms — slow drags just stop
      let vx = vel.x;
      let vy = vel.y;
      let prev = performance.now();
      const step = (now: number) => {
        const dt = Math.min(50, now - prev);
        prev = now;
        const decay = Math.exp(-dt / 170);
        vx *= decay;
        vy *= decay;
        const cam = camRef.current;
        cam.x -= (vx * dt) / cam.z;
        cam.y -= (vy * dt) / cam.z;
        clampCam(cam);
        apply();
        if (Math.hypot(vx, vy) > 0.02) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = 0;
          apply(true);
        }
      };
      rafRef.current = requestAnimationFrame(step);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const p = local(e.clientX, e.clientY);
      pointers.set(e.pointerId, p);
      stopAnim();
      if (pointers.size === 1) {
        panStart = { sx: p.x, sy: p.y, cam: { ...camRef.current } };
        dragMoved = false;
        last = { x: p.x, y: p.y, t: performance.now() };
        vel = { x: 0, y: 0 };
        setIsPanning(true);
      } else if (pointers.size === 2) {
        panStart = null;
        const [a, b] = [...pointers.values()];
        pinchStart = { dist: dist(a, b), mid: mid(a, b), cam: { ...camRef.current } };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = local(e.clientX, e.clientY);
      pointers.set(e.pointerId, p);

      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        const base = pinchStart.cam;
        const { w, h } = viewportRef.current;
        const nz = clamp(base.z * (dist(a, b) / pinchStart.dist), minZoom(), maxZoom);
        const m = mid(a, b);
        const wx = (pinchStart.mid.x - w / 2) / base.z + base.x;
        const wy = (pinchStart.mid.y - h / 2) / base.z + base.y;
        const cam = camRef.current;
        cam.z = nz;
        cam.x = wx - (m.x - w / 2) / nz;
        cam.y = wy - (m.y - h / 2) / nz;
        clampCam(cam);
        apply();
        dragMoved = true;
        return;
      }

      if (panStart) {
        const dx = p.x - panStart.sx;
        const dy = p.y - panStart.sy;
        if (Math.hypot(dx, dy) > 5) dragMoved = true;
        const cam = camRef.current;
        cam.x = panStart.cam.x - dx / panStart.cam.z;
        cam.y = panStart.cam.y - dy / panStart.cam.z;
        clampCam(cam);
        apply();
        const now = performance.now();
        const dt = now - last.t;
        if (dt > 0 && dt < 80) vel = { x: (p.x - last.x) / dt, y: (p.y - last.y) / dt };
        last = { x: p.x, y: p.y, t: now };
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        if (dragMoved) {
          suppressClick = true;
          startInertia();
        }
        panStart = null;
        pinchStart = null;
        dragMoved = false;
        setIsPanning(false);
      } else if (pointers.size === 1) {
        const p = [...pointers.values()][0]!;
        pinchStart = null;
        panStart = { sx: p.x, sy: p.y, cam: { ...camRef.current } };
        dragMoved = true; // a finger lifted mid-pinch: don't fire a click
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopAnim();
      const p = local(e.clientX, e.clientY);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0016));
    };

    const onDblClick = (e: MouseEvent) => {
      const p = local(e.clientX, e.clientY);
      stopAnim();
      zoomAt(p.x, p.y, 1.6);
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("dblclick", onDblClick);
    el.addEventListener("click", onClickCapture, true);

    return () => {
      ro.disconnect();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("dblclick", onDblClick);
      el.removeEventListener("click", onClickCapture, true);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [apply, clampCam, minZoom, maxZoom, stopAnim, worldWidth, worldHeight]);

  return { containerRef, layerRef, view, viewport, isPanning, flyTo, fitAll, zoomBy };
}
