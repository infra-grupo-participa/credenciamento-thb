// Feedback sonoro curto via WebAudio (sem arquivos).
let ctx;
function tom(freq, dur, type = 'sine', delay = 0) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / 1000);
    o.start(t); o.stop(t + dur / 1000 + 0.02);
  } catch { /* ignora */ }
}
// Vibração (celular): feedback que o operador sente mesmo em salão barulhento.
function vibrar(padrao) {
  try { if (navigator.vibrate) navigator.vibrate(padrao); } catch { /* ignora */ }
}

export const beepOk = () => { tom(880, 90); tom(1320, 120, 'sine', 0.09); vibrar(60); };
export const beepErr = () => { tom(200, 240, 'square'); vibrar([90, 60, 90]); };
