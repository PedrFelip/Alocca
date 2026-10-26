// RN02 — validação de CPF pelos dígitos verificadores (módulo 11).
// RN04 — sanitização: aceita entrada com pontuação e devolve só os 11 dígitos.
const CPF_SOMENTE_DIGITOS = /^\d{11}$/
const CPF_DIGITOS_REPETIDOS = /^(\d)\1{10}$/

export function higienizarCpf(entrada: string): string {
  return entrada.replace(/\D/g, '')
}

export function validarCpf(entrada: string): boolean {
  const cpf = higienizarCpf(entrada)
  if (!CPF_SOMENTE_DIGITOS.test(cpf) || CPF_DIGITOS_REPETIDOS.test(cpf)) {
    return false
  }
  for (let posicao = 9; posicao < 11; posicao++) {
    let soma = 0
    for (let indice = 0; indice < posicao; indice++) {
      soma += Number(cpf[indice]) * (posicao + 1 - indice)
    }
    const resto = (soma * 10) % 11
    const digito = resto === 10 ? 0 : resto
    if (Number(cpf[posicao]) !== digito) return false
  }
  return true
}
