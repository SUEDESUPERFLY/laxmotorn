// Läxmotorns filmkit: hjälpfunktioner och gemensamma färgverlopp för förklaringsfilmer i HyperFrames.
// Laddas sist i <body>, före filmens eget skript. Allt är deterministiskt (ingen slump, ingen klocka).
window.K = (() => {
  gsap.registerPlugin(MotionPathPlugin);
  const LEAD = 0.6;                                   // rösten börjar 0,6 s in i filmen
  const W = (s) => LEAD + s;                          // tid i ljudfilen → filmtid
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
  const NS = "http://www.w3.org/2000/svg";
  // Kamera för ett .world-lager (transform-origin 0 0): zooma mot (cx, cy) utan att visa kanter.
  const cam = (scale, cx, cy) => ({
    scale,
    x: Math.min(0, Math.max(1920 - 1920 * scale, 960 - cx * scale)),
    y: Math.min(0, Math.max(1080 - 1080 * scale, 540 - cy * scale)),
  });
  // Rita fram en linje (path, line, circle …). Osynlig tills den börjar ritas, så runda ändar inte syns som prickar.
  function drawIn(tl, el, t, dur = 0.8, ease = "power2.out") {
    const els = typeof el === "string" ? qa(el) : [].concat(el);
    els.forEach((e, i) => {
      const n = e.getTotalLength(); e.style.strokeDasharray = n + " " + n; e.style.strokeDashoffset = n; e.style.opacity = 0;
      tl.set(e, { opacity: 1 }, t + i * 0.1);
      tl.fromTo(e, { strokeDashoffset: n }, { strokeDashoffset: 0, duration: dur, ease, immediateRender: false }, t + i * 0.1);
    });
  }
  // Etikett eller symbol som landar (lätt fjädring) och som försvinner.
  const pop = (tl, sel, t, dur = 0.5) => tl.fromTo(sel, { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: dur, ease: "back.out(1.6)" }, t);
  const out = (tl, sel, t, dur = 0.3) => tl.to(sel, { opacity: 0, duration: dur, ease: "power3.in" }, t);
  // Text som skärps fram (rubriker, enstaka rader).
  const blurIn = (tl, sel, t, dur = 0.22) => tl.fromTo(sel, { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: dur, ease: "power4.out" }, t);
  // Byte mellan två lager på samma scen (oskärpa ut, oskärpa in).
  function swap(tl, from, to, t) {
    if (from) tl.to(from, { opacity: 0, filter: "blur(10px)", duration: 0.35, ease: "power3.in" }, t);
    tl.fromTo(to, { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.4, ease: "power2.out" }, t + 0.2);
  }
  // Ett element som färdas längs en osynlig bana (vattendroppar, molekyler, pilar med flöde).
  function along(tl, el, path, t, dur = 2, ease = "power1.inOut") {
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2 }, t);
    tl.fromTo(el, { motionPath: { path, align: path, alignOrigin: [0.5, 0.5], start: 0, end: 0 } },
      { motionPath: { path, align: path, alignOrigin: [0.5, 0.5], start: 0, end: 1 }, duration: dur, ease, immediateRender: false }, t);
    tl.to(el, { opacity: 0, duration: 0.25 }, t + dur - 0.1);
  }
  // Seedad slump för mönster (celler, korn): samma bild varje gång.
  const rng = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Fyller en <g> med oregelbundna växtceller (närbild av ett blad).
  function cells(gSel, seed = 7, color = "url(#kCell)") {
    const g = q(gSel), rnd = rng(seed);
    for (let r = -1; r < 10; r++) for (let c = -1; c < 13; c++) {
      const cx = c * 160 + (r % 2 ? 80 : 0) + (rnd() - .5) * 40, cy = r * 120 + (rnd() - .5) * 30, n = 7, pts = [];
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; pts.push([cx + Math.cos(a) * (70 + rnd() * 12), cy + Math.sin(a) * (52 + rnd() * 10)]); }
      let d = "M" + ((pts[n - 1][0] + pts[0][0]) / 2).toFixed(1) + " " + ((pts[n - 1][1] + pts[0][1]) / 2).toFixed(1);
      pts.forEach((p, k) => { const p2 = pts[(k + 1) % n]; d += " Q" + p[0].toFixed(1) + " " + p[1].toFixed(1) + " " + ((p[0] + p2[0]) / 2).toFixed(1) + " " + ((p[1] + p2[1]) / 2).toFixed(1); });
      const el = document.createElementNS(NS, "path"); el.setAttribute("d", d + "Z"); el.setAttribute("fill", color); el.setAttribute("stroke", "#2a6a2b"); el.setAttribute("stroke-width", "6"); g.appendChild(el);
    }
  }
  // Gemensamma färgverlopp, nåbara överallt som url(#kSun) osv.
  const defs = document.createElementNS(NS, "svg");
  defs.setAttribute("width", "0"); defs.setAttribute("height", "0"); defs.style.position = "absolute";
  defs.innerHTML = `<defs>
    <linearGradient id="kSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe7f4"/><stop offset="1" stop-color="#f6f1e2"/></linearGradient>
    <linearGradient id="kSoil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a57249"/><stop offset=".45" stop-color="#7a4b2d"/><stop offset="1" stop-color="#4f2e1b"/></linearGradient>
    <linearGradient id="kLeaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fd46f"/><stop offset=".55" stop-color="#4ea84a"/><stop offset="1" stop-color="#2b7c39"/></linearGradient>
    <linearGradient id="kStem" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3f9145"/><stop offset=".5" stop-color="#5fb556"/><stop offset="1" stop-color="#2f7a38"/></linearGradient>
    <linearGradient id="kWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fc4f2"/><stop offset="1" stop-color="#2f8fd8"/></linearGradient>
    <radialGradient id="kSun" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#fff6c4"/><stop offset=".55" stop-color="#ffd64a"/><stop offset="1" stop-color="#f4a915"/></radialGradient>
    <radialGradient id="kGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe680" stop-opacity=".75"/><stop offset="1" stop-color="#ffe680" stop-opacity="0"/></radialGradient>
    <radialGradient id="kCell" cx=".5" cy=".45" r=".6"><stop offset="0" stop-color="#9ad97c"/><stop offset="1" stop-color="#4f9e45"/></radialGradient>
    <radialGradient id="kSkin" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="#f7d6b3"/><stop offset="1" stop-color="#e9b98c"/></radialGradient>
    <radialGradient id="kPlanet" cx=".35" cy=".35" r=".75"><stop offset="0" stop-color="#9fd0f3"/><stop offset=".6" stop-color="#2f8fd8"/><stop offset="1" stop-color="#1d4f8a"/></radialGradient>
    <linearGradient id="kNight" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1a33"/><stop offset="1" stop-color="#253a66"/></linearGradient>
    <linearGradient id="kPaper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#f3eedf"/></linearGradient>
  </defs>`;
  document.body.prepend(defs);
  return { LEAD, W, q, qa, cam, drawIn, pop, out, blurIn, swap, along, rng, cells };
})();
