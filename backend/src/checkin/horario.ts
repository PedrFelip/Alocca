const MINUTO = 60 * 1000

// checkin de 10 minutos ate o fim e o checkout de 45 minutos depois do fim
const ANTES_DO_INICIO = 10 * MINUTO
export const DEPOIS_DO_FIM = 45 * MINUTO

export function checkinLiberadoEm(inicio: Date) {
  return new Date(inicio.getTime() - ANTES_DO_INICIO)
}

export function checkoutAte(fim: Date) {
  return new Date(fim.getTime() + DEPOIS_DO_FIM)
}

export function podeFazerCheckin(inicio: Date, fim: Date, agora: Date) {
  return agora >= checkinLiberadoEm(inicio) && agora <= fim
}

export function podeFazerCheckout(fim: Date, agora: Date) {
  return agora <= checkoutAte(fim)
}
