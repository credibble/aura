/**
 * Window: one prediction-market window as a machine on a plinth. A carriage
 * rides two rails toward a gate — the window's clock; the pointer's position
 * along the track is the time. Reach the gate and its bar drops across the
 * track (the window freezes); go past it and the payout tray beyond tips, and
 * its coin rolls to the settled side. The slider is the tray's tip, in degrees.
 *
 * The pattern: scrub and pick. A spring for where (the carriage follows the
 * time), tweens for which (the gate's bar, the tray's tip), and a hit test on
 * the ground plane, which never moves.
 */
const {
  Cam, clamp, facing, fit, hull, open, poly, prism, proj, rad, ringAt, rings, rrect, run, unproj,
  spring, stepS, tdone, tset, tval, tween, disposer, mk, pointer, put, register, solid,
} = HL;

// Track along x, W wide; the gate at GX; the tray's fulcrum at TX.
const W = 34, X0 = 6, GX = 122, TX = 156, BAR_UP = 22, BAR_H = 5, CAR = 18, CH = 11;
const XMIN = X0 + CAR / 2 + 2, XMAX = GX - CAR / 2 - 6, REST_X = X0 + 46;
const TY = W / 2, TZ = 9, TU = 13, TV = 15, LIP = 5;

function mount({ stage, svg, read }, value) {
  const bag = disposer();
  let tip = value;

  const C = Cam(45, 0.5, 1.9);
  fit(C, [[-2, -6, -5], [TX + 22, -6, -5], [-2, W + 6, -5], [TX + 22, W + 6, -5], [GX, -4, BAR_UP + BAR_H + 6], [TX, TY - TV, TZ + 12]], 200, 166);
  const P = proj(C), front = facing(C);
  const g = mk("g", {}, svg);

  // the plinth, and on it two rails and the dashed line the carriage keeps time along
  const [pr, pi] = rings(-2, -6, TX + 22, W + 6, 8, 2);
  put(solid(g), prism(P, front, pr, pi, -5, 0));
  mk("path", { d: open([P(X0, TY, 0), P(GX - 4, TY, 0)]), class: "nf dash" }, g);
  for (const y of [8, W - 8]) mk("path", { d: open([P(X0, y, 0), P(GX + 6, y, 0)]), class: "nf lo" }, g);

  // the gate's far post, painted before the carriage it stands behind
  const post = (y0) => { const [r, i] = rings(GX - 3, y0, GX + 3, y0 + 6, 2, 0.8); const s = solid(g); put(s, prism(P, front, r, i, 0, BAR_UP + BAR_H + 4)); return s; };
  post(-5);

  // the carriage: a block with a lid mark (three dots across, the clock's hand)
  const car = solid(g), lid = mk("path", { class: "nf lo" }, g);
  const car0 = rings(-CAR / 2, 5, CAR / 2, W - 5, 3, 1);
  const carX = spring(REST_X);
  let carDrawn = NaN;
  function drawCar() {
    const x = carX.x;
    if (x === carDrawn) return;
    carDrawn = x;
    const [r, i] = car0.map((ring) => ring.map((q) => ({ ...q, u: q.u + x })));
    put(car, prism(P, front, r, i, 0.5, CH));
    lid.setAttribute("d", open([P(x - 4, TY, CH), P(x + 4, TY, CH)]));
  }

  // the bar: a slab across the track between the posts; up while open, down when frozen
  const bar = solid(g), barZ = tween(BAR_UP);
  const [br, bi] = rings(GX - 2, 0, GX + 2, W, 1.5, 0.6);
  let barDrawn = NaN;
  function drawBar(z) {
    if (z === barDrawn) return;
    barDrawn = z;
    put(bar, prism(P, front, br, bi, z, z + BAR_H));
  }
  post(W - 1);

  // the tray on its fulcrum, past the gate; it tips about the x axis, and its coin rolls downhill
  const [fr, fi] = rings(TX - 4, TY - 5, TX + 4, TY + 5, 2, 0.8);
  put(solid(g), prism(P, front, fr, fi, 0, TZ - 1));
  const traySil = mk("path", { class: "sil" }, g), trayRim = mk("path", { class: "nf" }, g), trayIn = mk("path", { class: "nf lo" }, g);
  const coin = solid(g);
  const outer = rrect(-TU, -TV, TU, TV, 4, 4), inner = rrect(-TU + 2, -TV + 2, TU - 2, TV - 2, 2.5, 4);
  const coinR = rings(-4, -4, 4, 4, 4, 0.8);
  const trayA = tween(0);
  let trayDrawn = NaN;
  function drawTray(th) {
    if (th === trayDrawn) return;
    trayDrawn = th;
    const s = Math.sin(rad(th)), c = Math.cos(rad(th));
    const w = (ring, h) => ring.map((q) => P(TX + q.u, TY + q.v * c - h * s, TZ + q.v * s + h * c));
    traySil.setAttribute("d", poly(hull(w(outer, 0).concat(w(outer, LIP)))));
    trayRim.setAttribute("d", poly(w(outer, LIP)));
    trayIn.setAttribute("d", open(w(run(inner, (q) => !front(q)), 1)));
    // the coin sits on the floor, rolled toward the low side as the tray tips
    const v = clamp(-th / 26, -1, 1) * (TV - 6);
    const [r0, i0] = coinR.map((ring) => ring.map((q) => ({ ...q, u: q.u + TX, v: q.v + TY + v * c })));
    put(coin, prism(P, front, r0, i0, TZ + v * s + 0.6, TZ + v * s + 2.4));
  }

  // one place bright at a time: the carriage at rest and while open, the bar when frozen, the tray when settled
  let phase = "";
  function light(p) {
    car.sil.classList.toggle("hi", p === "rest" || p === "open");
    bar.sil.classList.toggle("hi", p === "frozen");
    traySil.classList.toggle("hi", p === "settled");
    coin.sil.classList.toggle("hi", p === "settled");
  }

  const B = register(stage, (dt, now) => {
    const m = stepS(carX, dt);
    drawCar();
    drawBar(tval(barZ, now));
    drawTray(tval(trayA, now));
    return m || !tdone(barZ, now) || !tdone(trayA, now);
  });
  bag.add(B.unregister);

  /** The phase from where the pointer stands on the ground: before the gate, at it, or past it. */
  function setPhase(p, x) {
    const now = performance.now();
    if (p === "rest") carX.t = REST_X;
    else carX.t = clamp(x, XMIN, XMAX);
    if (p !== phase) {
      phase = p;
      const shut = p === "frozen" || p === "settled";
      tset(barZ, shut ? 0.6 : BAR_UP, now, 0);
      tset(trayA, p === "settled" ? -tip : 0, now, shut ? 120 : 0);
      light(p);
      read.textContent = p;
    }
    B.wake();
  }

  bag.add(pointer(stage, {
    move: (p) => {
      const [x, y] = unproj(C, p[0], p[1], 0);
      if (y < -14 || y > W + 14 || x < -8 || x > TX + 26) return setPhase("rest", 0);
      setPhase(x < GX - 10 ? "open" : x < GX + 12 ? "frozen" : "settled", x);
    },
    leave: () => setPhase("rest", 0),
  }));
  setPhase("rest", 0);
  bag.add(() => svg.replaceChildren());

  return {
    set: (v) => { tip = v; if (phase === "settled") { tset(trayA, -tip, performance.now(), 0); B.wake(); } },
    destroy: bag.dispose,
  };
}

hairline({
  name: "window",
  means: "A market window as a track: time runs to the gate, the gate drops and freezes it, and the tray past it settles.",
  rules: [1, 4, 5, 8],
  range: [10, 18, 26],
  tour: [[189, 152], [251, 183], [291, 203], null],
  mount,
});
