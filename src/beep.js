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

// Sucesso: dois tons SUBINDO (880 -> 1320). "Entrou agora."
export const beepOk = () => { tom(880, 90); tom(1320, 120, 'sine', 0.09); vibrar(60); };
// Erro: um tom grave e áspero.
export const beepErr = () => { tom(200, 240, 'square'); vibrar([90, 60, 90]); };
// Já credenciado: dois toques IGUAIS e mais graves (440), com vibração dupla —
// em salão barulhento não pode ser confundido com o som de sucesso, senão o
// operador libera de novo quem já entrou.
export const beepDup = () => { tom(440, 110, 'triangle'); tom(440, 110, 'triangle', 0.17); vibrar([50, 90, 50]); };
