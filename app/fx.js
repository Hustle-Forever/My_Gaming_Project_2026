// app/fx.js - WebGL effects for the M2 site, no dependencies, CSP-safe.
// Vanilla ports of two React Bits components (their `ogl` wrapper replaced
// by ~60 lines of raw WebGL): the Orb (hero + voice-reactive listening orb)
// and the RippleGrid (hero background). Shaders are verbatim from the
// originals; only the plumbing differs.
//   M2FX.orb(container, opts)  -> { setLevel, setBackground, setHover, destroy }
//   M2FX.grid(container, opts) -> { setColor, setOpacity, destroy }
// Both render only while their container is visible, cap DPR at 2, and are
// skipped entirely under prefers-reduced-motion (callers keep CSS fallbacks).
(function () {
  'use strict';

  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hexToRgb(color) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(color) || '');
    return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0, 0, 0];
  }

  // ---- minimal WebGL plumbing (replaces ogl Renderer/Program/Triangle/Mesh) ----
  function createCtx(container) {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) return null;
    container.appendChild(canvas);
    return { canvas, gl };
  }

  function buildProgram(gl, vertSrc, fragSrc, withUv) {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[fx] shader:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, vertSrc);
    const fs = sh(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[fx] link:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);
    // fullscreen triangle (same geometry as ogl's Triangle)
    const bind = (name, data, size) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bind('position', [-1, -1, 3, -1, -1, 3], 2);
    if (withUv) bind('uv', [0, 0, 2, 0, 0, 2], 2);
    const cache = {};
    const u = (name) => (cache[name] !== undefined ? cache[name] : (cache[name] = gl.getUniformLocation(prog, name)));
    return {
      prog,
      f: (n, v) => gl.uniform1f(u(n), v),
      i: (n, v) => gl.uniform1i(u(n), v),
      v2: (n, a) => gl.uniform2f(u(n), a[0], a[1]),
      v3: (n, a) => gl.uniform3f(u(n), a[0], a[1], a[2]),
    };
  }

  function autoResize(ctx, container, onSize) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const apply = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      ctx.canvas.width = Math.round(w * dpr);
      ctx.canvas.height = Math.round(h * dpr);
      ctx.gl.viewport(0, 0, ctx.canvas.width, ctx.canvas.height);
      onSize(ctx.canvas.width, ctx.canvas.height);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(container); else window.addEventListener('resize', apply);
    apply();
    return () => { if (ro) ro.disconnect(); else window.removeEventListener('resize', apply); };
  }

  const visible = (el) => el.offsetParent !== null && el.clientWidth > 0;

  // ================= ORB (React Bits "Orb", JS+CSS variant) =================
  const ORB_VERT = `
    precision highp float;
    attribute vec2 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const ORB_FRAG = `
    precision highp float;
    uniform float iTime;
    uniform vec3 iResolution;
    uniform float hue;
    uniform float hover;
    uniform float rot;
    uniform float hoverIntensity;
    uniform vec3 backgroundColor;
    varying vec2 vUv;

    vec3 rgb2yiq(vec3 c) {
      float y = dot(c, vec3(0.299, 0.587, 0.114));
      float i = dot(c, vec3(0.596, -0.274, -0.322));
      float q = dot(c, vec3(0.211, -0.523, 0.312));
      return vec3(y, i, q);
    }
    vec3 yiq2rgb(vec3 c) {
      float r = c.x + 0.956 * c.y + 0.621 * c.z;
      float g = c.x - 0.272 * c.y - 0.647 * c.z;
      float b = c.x - 1.106 * c.y + 1.703 * c.z;
      return vec3(r, g, b);
    }
    vec3 adjustHue(vec3 color, float hueDeg) {
      float hueRad = hueDeg * 3.14159265 / 180.0;
      vec3 yiq = rgb2yiq(color);
      float cosA = cos(hueRad);
      float sinA = sin(hueRad);
      float i = yiq.y * cosA - yiq.z * sinA;
      float q = yiq.y * sinA + yiq.z * cosA;
      yiq.y = i; yiq.z = q;
      return yiq2rgb(yiq);
    }
    vec3 hash33(vec3 p3) {
      p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
      p3 += dot(p3, p3.yxz + 19.19);
      return -1.0 + 2.0 * fract(vec3(p3.x + p3.y, p3.x + p3.z, p3.y + p3.z) * p3.zyx);
    }
    float snoise3(vec3 p) {
      const float K1 = 0.333333333;
      const float K2 = 0.166666667;
      vec3 i = floor(p + (p.x + p.y + p.z) * K1);
      vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
      vec3 e = step(vec3(0.0), d0 - d0.yzx);
      vec3 i1 = e * (1.0 - e.zxy);
      vec3 i2 = 1.0 - e.zxy * (1.0 - e);
      vec3 d1 = d0 - (i1 - K2);
      vec3 d2 = d0 - (i2 - K1);
      vec3 d3 = d0 - 0.5;
      vec4 h = max(0.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
      vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)), dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
      return dot(vec4(31.316), n);
    }
    vec4 extractAlpha(vec3 colorIn) {
      float a = max(max(colorIn.r, colorIn.g), colorIn.b);
      return vec4(colorIn.rgb / (a + 1e-5), a);
    }
    const vec3 baseColor1 = vec3(0.611765, 0.262745, 0.996078);
    const vec3 baseColor2 = vec3(0.298039, 0.760784, 0.913725);
    const vec3 baseColor3 = vec3(0.062745, 0.078431, 0.600000);
    const float innerRadius = 0.6;
    const float noiseScale = 0.65;
    float light1(float intensity, float attenuation, float dist) {
      return intensity / (1.0 + dist * attenuation);
    }
    float light2(float intensity, float attenuation, float dist) {
      return intensity / (1.0 + dist * dist * attenuation);
    }
    vec4 draw(vec2 uv) {
      vec3 color1 = adjustHue(baseColor1, hue);
      vec3 color2 = adjustHue(baseColor2, hue);
      vec3 color3 = adjustHue(baseColor3, hue);
      float ang = atan(uv.y, uv.x);
      float len = length(uv);
      float invLen = len > 0.0 ? 1.0 / len : 0.0;
      float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));
      float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.5)) * 0.5 + 0.5;
      float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
      float d0 = distance(uv, (r0 * invLen) * uv);
      float v0 = light1(1.0, 10.0, d0);
      v0 *= smoothstep(r0 * 1.05, r0, len);
      float innerFade = smoothstep(r0 * 0.8, r0 * 0.95, len);
      v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
      float cl = cos(ang + iTime * 2.0) * 0.5 + 0.5;
      float a = iTime * -1.0;
      vec2 pos = vec2(cos(a), sin(a)) * r0;
      float d = distance(uv, pos);
      float v1 = light2(1.5, 5.0, d);
      v1 *= light1(1.0, 50.0, d0);
      float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
      float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
      vec3 colBase = mix(color1, color2, cl);
      float fadeAmount = mix(1.0, 0.1, bgLuminance);
      vec3 darkCol = mix(color3, colBase, v0);
      darkCol = (darkCol + v1) * v2 * v3;
      darkCol = clamp(darkCol, 0.0, 1.0);
      vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
      lightCol = mix(backgroundColor, lightCol, v0);
      lightCol = clamp(lightCol, 0.0, 1.0);
      vec3 finalCol = mix(darkCol, lightCol, bgLuminance);
      return extractAlpha(finalCol);
    }
    vec4 mainImage(vec2 fragCoord) {
      vec2 center = iResolution.xy * 0.5;
      float size = min(iResolution.x, iResolution.y);
      vec2 uv = (fragCoord - center) / size * 2.0;
      float angle = rot;
      float s = sin(angle);
      float c = cos(angle);
      uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
      uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime);
      uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime);
      return draw(uv);
    }
    void main() {
      vec2 fragCoord = vUv * iResolution.xy;
      vec4 col = mainImage(fragCoord);
      gl_FragColor = vec4(col.rgb * col.a, col.a);
    }
  `;

  function orb(container, opts) {
    opts = opts || {};
    const ctx = createCtx(container);
    if (!ctx) return null;
    const { gl, canvas } = ctx;
    const P = buildProgram(gl, ORB_VERT, ORB_FRAG, true);
    if (!P) { container.removeChild(canvas); return null; }
    gl.clearColor(0, 0, 0, 0);

    const hue = Number(opts.hue) || 0;
    const hoverIntensity = opts.hoverIntensity !== undefined ? opts.hoverIntensity : 0.2;
    const rotateOnHover = opts.rotateOnHover !== false;
    // voice character: hueShift warms the orb color while speaking; attack/
    // release shape the envelope (react fast, relax slowly - breathing, not
    // jitter). All optional; zero-cost when unused.
    const hueShift = Number(opts.hueShift) || 0;
    const attack = opts.attack !== undefined ? opts.attack : 0.35;
    const release = opts.release !== undefined ? opts.release : 0.08;
    // timeScale < 1 slows ALL shader motion (noise morph, wobble, highlight)
    const timeScale = opts.timeScale !== undefined ? opts.timeScale : 1;
    let background = hexToRgb(opts.background || '#000000');
    const eventTarget = opts.eventTarget || container;

    let res = [1, 1, 1];
    const stopResize = autoResize(ctx, container, (w, h) => { res = [w, h, w / h]; });

    let targetHover = 0;   // mouse proximity
    let level = 0;         // raw voice level (setLevel)
    let levelSm = 0;       // enveloped voice level (attack/release smoothing)
    let hoverVal = 0;
    let rot = 0;
    let last = 0;
    let rafId = 0;
    let dead = false;

    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const ux = ((e.clientX - rect.left - rect.width / 2) / size) * 2;
      const uy = ((e.clientY - rect.top - rect.height / 2) / size) * 2;
      targetHover = Math.sqrt(ux * ux + uy * uy) < 0.8 ? 1 : 0;
    };
    const onLeave = () => { targetHover = 0; };
    eventTarget.addEventListener('mousemove', onMove);
    eventTarget.addEventListener('mouseleave', onLeave);

    const tick = (t) => {
      if (dead) return;
      rafId = requestAnimationFrame(tick);
      const dt = (t - last) * 0.001;
      last = t;
      if (!visible(container)) return; // hidden view (e.g. console open) - skip GPU work
      levelSm += (level - levelSm) * (level > levelSm ? attack : release);
      const effective = Math.max(targetHover, Math.min(1, levelSm));
      hoverVal += (effective - hoverVal) * 0.1;
      // speech makes it turn gently, faster the louder you are
      if (rotateOnHover && effective > 0.15) rot += dt * (0.18 + effective * 0.35);
      gl.useProgram(P.prog);
      P.f('iTime', t * 0.001 * timeScale);
      P.v3('iResolution', res);
      P.f('hue', hue + hueShift * hoverVal);
      P.f('hover', hoverVal);
      P.f('rot', rot);
      P.f('hoverIntensity', hoverIntensity);
      P.v3('backgroundColor', background);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    rafId = requestAnimationFrame(tick);

    return {
      // voice reactivity: 0..1 mic level -> distortion + spin, decays upstream
      setLevel(v) { level = Math.max(0, Math.min(1.5, v)); },
      setHover(v) { targetHover = v ? 1 : 0; },
      setBackground(hex) { background = hexToRgb(hex); },
      destroy() {
        dead = true;
        cancelAnimationFrame(rafId);
        stopResize();
        eventTarget.removeEventListener('mousemove', onMove);
        eventTarget.removeEventListener('mouseleave', onLeave);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      },
    };
  }

  // ============== RIPPLE GRID (React Bits "RippleGrid", JS+CSS) ==============
  const GRID_VERT = `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const GRID_FRAG = `precision highp float;
    uniform float iTime;
    uniform vec2 iResolution;
    uniform bool enableRainbow;
    uniform vec3 gridColor;
    uniform float rippleIntensity;
    uniform float gridSize;
    uniform float gridThickness;
    uniform float fadeDistance;
    uniform float vignetteStrength;
    uniform float glowIntensity;
    uniform float opacity;
    uniform float gridRotation;
    uniform bool mouseInteraction;
    uniform vec2 mousePosition;
    uniform float mouseInfluence;
    uniform float mouseInteractionRadius;
    varying vec2 vUv;

    float pi = 3.141592;

    mat2 rotate(float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return mat2(c, -s, s, c);
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      uv.x *= iResolution.x / iResolution.y;

      if (gridRotation != 0.0) {
        uv = rotate(gridRotation * pi / 180.0) * uv;
      }

      float dist = length(uv);
      float func = sin(pi * (iTime - dist));
      vec2 rippleUv = uv + uv * func * rippleIntensity;

      if (mouseInteraction && mouseInfluence > 0.0) {
        vec2 mouseUv = (mousePosition * 2.0 - 1.0);
        mouseUv.x *= iResolution.x / iResolution.y;
        float mouseDist = length(uv - mouseUv);
        float influence = mouseInfluence * exp(-mouseDist * mouseDist / (mouseInteractionRadius * mouseInteractionRadius));
        float mouseWave = sin(pi * (iTime * 2.0 - mouseDist * 3.0)) * influence;
        rippleUv += normalize(uv - mouseUv) * mouseWave * rippleIntensity * 0.3;
      }

      vec2 a = sin(gridSize * 0.5 * pi * rippleUv - pi / 2.0);
      vec2 b = abs(a);

      float aaWidth = 0.5;
      vec2 smoothB = vec2(
        smoothstep(0.0, aaWidth, b.x),
        smoothstep(0.0, aaWidth, b.y)
      );

      vec3 color = vec3(0.0);
      color += exp(-gridThickness * smoothB.x * (0.8 + 0.5 * sin(pi * iTime)));
      color += exp(-gridThickness * smoothB.y);
      color += 0.5 * exp(-(gridThickness / 4.0) * sin(smoothB.x));
      color += 0.5 * exp(-(gridThickness / 3.0) * smoothB.y);

      if (glowIntensity > 0.0) {
        color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.x);
        color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.y);
      }

      // fadeDistance <= 0 disables the center-spotlight fade entirely
      // (port extension): a full-bleed background grid wants even coverage,
      // with only the vignette shaping the edges.
      float ddd = fadeDistance > 0.0 ? exp(-2.0 * clamp(pow(dist, fadeDistance), 0.0, 1.0)) : 1.0;

      vec2 vignetteCoords = vUv - 0.5;
      float vignetteDistance = length(vignetteCoords);
      // Softened vs upstream (1.0 - pow(d*2, strength), clamped): that clips
      // to ZERO past half the container width, so a wide full-bleed hero
      // could never show the grid at its edges. Exponential falloff keeps
      // the same center-weighted look without ever hard-clipping.
      float vignette = exp(-pow(vignetteDistance * 2.0, vignetteStrength));

      vec3 t;
      if (enableRainbow) {
        t = vec3(
          uv.x * 0.5 + 0.5 * sin(iTime),
          uv.y * 0.5 + 0.5 * cos(iTime),
          pow(cos(iTime), 4.0)
        ) + 0.5;
      } else {
        t = gridColor;
      }

      float finalFade = ddd * vignette;
      float alpha = length(color) * finalFade * opacity;
      gl_FragColor = vec4(color * t * finalFade * opacity, alpha);
    }`;

  function grid(container, opts) {
    opts = opts || {};
    const ctx = createCtx(container);
    if (!ctx) return null;
    const { gl, canvas } = ctx;
    const P = buildProgram(gl, GRID_VERT, GRID_FRAG, false);
    if (!P) { container.removeChild(canvas); return null; }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const eventTarget = opts.eventTarget || container;
    const state = {
      enableRainbow: !!opts.enableRainbow,
      gridColor: hexToRgb(opts.gridColor || '#ffffff'),
      rippleIntensity: opts.rippleIntensity !== undefined ? opts.rippleIntensity : 0.05,
      gridSize: opts.gridSize !== undefined ? opts.gridSize : 10.0,
      gridThickness: opts.gridThickness !== undefined ? opts.gridThickness : 15.0,
      fadeDistance: opts.fadeDistance !== undefined ? opts.fadeDistance : 1.5,
      vignetteStrength: opts.vignetteStrength !== undefined ? opts.vignetteStrength : 2.0,
      glowIntensity: opts.glowIntensity !== undefined ? opts.glowIntensity : 0.1,
      opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
      gridRotation: opts.gridRotation !== undefined ? opts.gridRotation : 0,
      mouseInteraction: opts.mouseInteraction !== false,
      mouseInteractionRadius: opts.mouseInteractionRadius !== undefined ? opts.mouseInteractionRadius : 1,
    };

    let res = [1, 1];
    const stopResize = autoResize(ctx, container, (w, h) => { res = [w, h]; });

    const mouse = { x: 0.5, y: 0.5 };
    const target = { x: 0.5, y: 0.5 };
    let influenceTarget = 0;
    let influence = 0;
    let rafId = 0;
    let dead = false;

    const onMove = (e) => {
      const rect = container.getBoundingClientRect();
      target.x = (e.clientX - rect.left) / rect.width;
      target.y = 1.0 - (e.clientY - rect.top) / rect.height;
      influenceTarget = 1;
    };
    const onLeave = () => { influenceTarget = 0; };
    if (state.mouseInteraction) {
      eventTarget.addEventListener('mousemove', onMove);
      eventTarget.addEventListener('mouseleave', onLeave);
    }

    const tick = (t) => {
      if (dead) return;
      rafId = requestAnimationFrame(tick);
      if (!visible(container)) return;
      mouse.x += (target.x - mouse.x) * 0.1;
      mouse.y += (target.y - mouse.y) * 0.1;
      influence += (influenceTarget - influence) * 0.05;
      gl.useProgram(P.prog);
      P.f('iTime', t * 0.001);
      P.v2('iResolution', res);
      P.i('enableRainbow', state.enableRainbow ? 1 : 0);
      P.v3('gridColor', state.gridColor);
      P.f('rippleIntensity', state.rippleIntensity);
      P.f('gridSize', state.gridSize);
      P.f('gridThickness', state.gridThickness);
      P.f('fadeDistance', state.fadeDistance);
      P.f('vignetteStrength', state.vignetteStrength);
      P.f('glowIntensity', state.glowIntensity);
      P.f('opacity', state.opacity);
      P.f('gridRotation', state.gridRotation);
      P.i('mouseInteraction', state.mouseInteraction ? 1 : 0);
      P.v2('mousePosition', [mouse.x, mouse.y]);
      P.f('mouseInfluence', influence);
      P.f('mouseInteractionRadius', state.mouseInteractionRadius);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    rafId = requestAnimationFrame(tick);

    return {
      setColor(hex) { state.gridColor = hexToRgb(hex); },
      setOpacity(v) { state.opacity = v; },
      destroy() {
        dead = true;
        cancelAnimationFrame(rafId);
        stopResize();
        if (state.mouseInteraction) {
          eventTarget.removeEventListener('mousemove', onMove);
          eventTarget.removeEventListener('mouseleave', onLeave);
        }
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      },
    };
  }

  window.M2FX = { reduced, orb, grid };
})();
