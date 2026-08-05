import { useEffect, useState } from 'react';

// Tela acesa e parada não precisa consultar o servidor.
//
// O React Query já pausa o polling quando a ABA sai de vista (visibilitychange),
// mas não quando a aba está bem na frente e ninguém encosta nela — que é o caso
// do tablet no balcão ligado o dia todo. Era daí que vinha o egress: a tela
// visível e ociosa continuava puxando a lista a cada 5 segundos.
//
// Depois de `ms` sem sinal de gente, devolve true e o chamador desliga o
// refetchInterval. Qualquer toque, tecla ou volta para a aba religa na hora.
export function useOcioso(ms) {
  const [ocioso, setOcioso] = useState(false);

  useEffect(() => {
    let t;
    const rearma = () => {
      clearTimeout(t);
      setOcioso((v) => (v ? false : v)); // só re-renderiza se estava pausado
      t = setTimeout(() => setOcioso(true), ms);
    };
    // `passive` para não atrapalhar o scroll da lista no tablet.
    // `chf:atividade` é o sinal para trabalho que NÃO gera evento de input: o
    // scanner em modo quiosque lê QR por câmera e wake-lock, e o operador pode
    // passar vários minutos sem encostar na tela. Sem isso a lista congelaria
    // no meio do balcão e o beep de duplicado deixaria de soar.
    const sinais = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'chf:atividade'];
    sinais.forEach((e) => window.addEventListener(e, rearma, { passive: true }));
    const aoVoltar = () => { if (!document.hidden) rearma(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', rearma);

    rearma();
    return () => {
      clearTimeout(t);
      sinais.forEach((e) => window.removeEventListener(e, rearma));
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', rearma);
    };
  }, [ms]);

  return ocioso;
}
