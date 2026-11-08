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

/** Screen-space bands covered by page chrome (px from each viewport edge). */
export type Insets = { top: number; bottom: number };
const NO_INSETS: Insets = { top: 0, bottom: 0 };

export function usePanZoom({
  worldWidth,
  worldHeight,
  maxZoom = 1.8,
  tiltDeg = 0,
  tiltPerspective = 1500,
  contentWidth,
  contentHeight,
  insets = NO_INSETS,
}: {
  worldWidth: number;
  worldHeight: number;
  maxZoom?: number;
  /**
   * Camera tilt: the plane is rendered rotated `tiltDeg` about the x-axis and
   * viewed through `tiltPerspective` px of perspective. Every gesture is
   * un-projected through that tilt, so the world point under the pointer
   * stays under the pointer exactly as if the plane were flat.
   */
  tiltDeg?: number;
  tiltPerspective?: number;
  /**
   * The content block "fit" frames (default: the whole world). Smaller than
   * the world when the world carries empty padding — the camera lands on the
   * content, and zooming out (to the world fit) reveals the padding.
   */
  contentWidth?: number;
  contentHeight?: number;
  /**
   * Chrome floating over the map (hero on top, dock at the bottom). "Fit" and
   * `flyToFramed` frame into the band between them instead of the full
   * viewport, so the default view never parks content under an overlay.
   */
  insets?: Insets;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef<Camera>({ x: worldWidth / 2, y: worldHeight / 2, z: 0.35 });
  const viewportRef = useRef({ w: 1, h: 1 });
  const fitRef = useRef(0.35);
  const worldFitRef = useRef(0.35);
  const initedRef = useRef(false);
  const reducedRef = useRef(false);
  const rafRef = useRef(0);
  const commitAtRef = useRef(0);
  const insetsRef = useRef<Insets>(insets);
  /** Set by the first user gesture: until then, a resize / inset change re-fits. */
  const touchedRef = useRef(false);

  const tiltRad = (tiltDeg * Math.PI) / 180;
  const tiltCos = Math.cos(tiltRad);
  const tiltSin = Math.sin(tiltRad);
  const P = tiltPerspective;
  /**
   * rotateX(θ) sends the plane's TOP away from the viewer (z' = qy·sinθ), so a
   * plane point qy below the viewport centre lands on screen at
   * ry = qy·cosθ·P / (P − qy·sinθ), its x magnified by P / (P − qy·sinθ).
   */
  const project = useCallback(
    (qy: number) => (tiltDeg ? (qy * tiltCos * P) / (P - qy * tiltSin) : qy),
    [tiltDeg, tiltCos, tiltSin, P],
  );
  /** Screen offset from the viewport centre → plane offset (inverse of `project`). */
  const unproject = useCallback(
    (ry: number) => (tiltDeg ? (ry * P) / (P * tiltCos + ry * tiltSin) : ry),
    [tiltDeg, tiltCos, tiltSin, P],
  );

  const [view, setView] = useState<Camera>(camRef.current);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  // Zoom floor is the WORLD fit (padding included); `fitRef` is the content fit.
  const minZoom = useCallback(() => Math.max(0.02, worldFitRef.current * 0.8), []);

  /** Push `camRef` onto the layer's transform; mirror to state at most ~11fps. */
  const apply = useCallback((commit = false) => {
    const layer = layerRef.current;
    if (!layer) return;
    const { w, h } = viewportRef.current;
    const { x, y, z } = camRef.current;
    layer.style.transform = `translate3d(${w / 2 - x * z}px, ${h / 2 - y * z}px, 0) scale(${z})`;
    // Below a bit past "fit" the labels would be noise; hide them until zoomed.
    layer.dataset.zoom = z >= fitRef.current * 1.35 ? "in" : "out";
    // Villagers scale sub-linearly (apparent size ∝ √z): readable zoomed out,
    // not chunky zoomed in. = 1 at the content fit.
    layer.style.setProperty("--char-scale", Math.sqrt(fitRef.current / z).toFixed(4));
    const now = performance.now();
    if (commit || now - commitAtRef.current > 90) {
      commitAtRef.current = now;
      setView({ x, y, z });
    }
  }, []);

  const clampCam = useCallback(
    (cam: Camera): Camera => {
      cam.z = clamp(cam.z, minZoom(), maxZoom);
      // The camera centre stays over the world. (Tilted, the far half of the
      // view sees much further than the near half, so a symmetric "keep both
      // edges in view" clamp is wrong; the ground is padded far past the
      // world edge in the page colour, so nothing ever shows a seam.)
      cam.x = clamp(cam.x, 0, worldWidth);
      cam.y = clamp(cam.y, 0, worldHeight);
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

  /** Screen y of the free band's centre, as an offset from the viewport centre. */
  const bandCentre = useCallback(() => {
    const { h } = viewportRef.current;
    const { top, bottom } = insetsRef.current;
    return (top + (h - bottom)) / 2 - h / 2;
  }, []);

  /**
   * The camera that puts world point (x, y) at the centre of the free band
   * (between the insets) at scale z — un-projected through the tilt, so it
   * lands there exactly.
   */
  const framed = useCallback(
    (x: number, y: number, z: number): Camera => ({ x, y: y - unproject(bandCentre()) / z, z }),
    [bandCentre, unproject],
  );

  /** Like `flyTo`, but lands the point mid-band rather than under the hero. */
  const flyToFramed = useCallback(
    (x: number, y: number, z?: number, ms = 650) => {
      const zz = clamp(z ?? camRef.current.z, minZoom(), maxZoom);
      const c = framed(x, y, zz);
      flyTo(c.x, c.y, c.z, ms);
    },
    [flyTo, framed, minZoom, maxZoom],
  );

  /**
   * The largest scale at which the content block fits inside the free band:
   * its far edge below the top inset, its near edge above the bottom inset,
   * and its near (widest, perspective-enlarged) edge inside the width. A
   * bisection over z. For each z the block's PROJECTION is centred in the band
   * — not its midpoint: perspective stretches the near half, so the midpoint
   * sits above the projected centre.
   *
   * Returns the fit camera (content centred in the world, so x/y are offset
   * from the world centre by the centring shift).
   */
  const computeFit = useCallback((): Camera => {
    const { w, h } = viewportRef.current;
    const { top, bottom } = insetsRef.current;
    const cw = contentWidth ?? worldWidth;
    const ch = contentHeight ?? worldHeight;
    const cx = worldWidth / 2;
    const cy = worldHeight / 2;
    const margin = 12;
    // Villagers stand UP out of the plane, so the back row's heads + tags rise
    // above the block's far edge: leave them room under the top chrome.
    const headroom = top > 0 ? 56 : 0;
    const bandTop = top + margin + headroom - h / 2;
    const bandBot = h - bottom - margin - h / 2;
    if (bandBot - bandTop < 80) {
      return { x: cx, y: cy, z: Math.min(w / cw, h / (ch * tiltCos)) || 0.35 };
    }
    const mid = (bandTop + bandBot) / 2;
    /** Plane offset of the block's centre that centres its projection mid-band. */
    const centreAt = (z: number) => {
      const half = (ch * z) / 2;
      let lo = -h * 4;
      let hi = h * 4;
      for (let i = 0; i < 48; i++) {
        const y0 = (lo + hi) / 2;
        if ((project(y0 - half) + project(y0 + half)) / 2 < mid) lo = y0;
        else hi = y0;
      }
      return (lo + hi) / 2;
    };
    const fits = (z: number) => {
      const half = (ch * z) / 2;
      const near = centreAt(z) + half;
      if (tiltDeg && near * tiltSin >= P * 0.95) return false; // at/behind the eye
      const k = tiltDeg ? P / (P - near * tiltSin) : 1;
      return (
        project(near - 2 * half) >= bandTop - 0.5 &&
        project(near) <= bandBot + 0.5 &&
        (cw * z * k) / 2 <= w / 2 - margin
      );
    };
    let lo = 0.005;
    let hi = 4;
    for (let i = 0; i < 40; i++) {
      const z = (lo + hi) / 2;
      if (fits(z)) lo = z;
      else hi = z;
    }
    return { x: cx, y: cy - centreAt(lo) / lo, z: lo };
  }, [contentWidth, contentHeight, worldWidth, worldHeight, project, tiltCos, tiltSin, tiltDeg, P]);

  /** The fit camera (see `computeFit`); refreshed on every measure. */
  const fitCamRef = useRef<Camera>({ x: worldWidth / 2, y: worldHeight / 2, z: 0.35 });
  const refit = useCallback(() => {
    fitCamRef.current = computeFit();
    fitRef.current = fitCamRef.current.z;
  }, [computeFit]);

  /** The content block, framed in the free band. */
  const fitAll = useCallback(
    (ms = 600) => {
      const c = fitCamRef.current;
      flyTo(c.x, c.y, c.z, ms);
    },
    [flyTo],
  );

  // Chrome measured after mount (or resized): re-fit, unless the user has
  // already moved the camera themselves.
  useEffect(() => {
    insetsRef.current = insets;
    if (!initedRef.current) return;
    refit();
    if (!touchedRef.current) camRef.current = clampCam({ ...fitCamRef.current });
    apply(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.top, insets.bottom]);

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
      refit();
      worldFitRef.current = Math.min(w / worldWidth, h / (worldHeight * tiltCos)) || 0.35;
      if (!initedRef.current || !touchedRef.current) {
        initedRef.current = true;
        camRef.current = clampCam({ ...fitCamRef.current });
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

    /** The first real gesture: stops auto re-fitting and retires the hint. */
    const touch = () => {
      if (touchedRef.current) return;
      touchedRef.current = true;
      setHasInteracted(true);
    };

    /** Viewport px → plane px. With the tilt on, this un-projects the point
        through rotateX(tiltDeg) + perspective (both taken about the viewport
        centre), so every gesture below runs in the same flat coordinates the
        camera transform writes — the map point under the pointer stays under
        the pointer. */
    const local = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      let px = clientX - r.left;
      let py = clientY - r.top;
      if (tiltDeg) {
        const { w, h } = viewportRef.current;
        const qy = unproject(py - h / 2);
        const qx = ((px - w / 2) * (P - qy * tiltSin)) / P;
        px = w / 2 + qx;
        py = h / 2 + qy;
      }
      return { x: px, y: py };
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
      // NO setPointerCapture here: capturing on pointerdown retargets the
      // browser's compat click to the viewport, so a plain tap on a villager
      // would never reach its link. Capture is taken the moment this IS a drag
      // (pointermove below).
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
        // Two fingers = pinch. Capture both so the gesture survives the
        // fingers leaving the plane (only on the pinch's first move).
        if (!dragMoved) {
          for (const pid of pointers.keys()) {
            try {
              el.setPointerCapture(pid);
            } catch {
              /* pointer already gone */
            }
          }
        }
        touch();
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
        if (Math.hypot(dx, dy) > 5 && !dragMoved) {
          dragMoved = true;
          touch();
          // It's a drag — capture now (see onPointerDown) and let the click
          // that follows be suppressed.
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* pointer already up */
          }
        }
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
      touch();
      const p = local(e.clientX, e.clientY);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0016));
    };

    const onDblClick = (e: MouseEvent) => {
      touch();
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
  }, [
    apply,
    clampCam,
    minZoom,
    maxZoom,
    stopAnim,
    worldWidth,
    worldHeight,
    tiltDeg,
    tiltCos,
    tiltSin,
    P,
    unproject,
    refit,
    framed,
  ]);

  return {
    containerRef,
    layerRef,
    view,
    viewport,
    isPanning,
    hasInteracted,
    flyTo,
    flyToFramed,
    fitAll,
    zoomBy,
  };
}
