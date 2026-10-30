export const mensagensOficiais = {
  'MSG-01': 'E-mail, CPF, CRM ou senha incorretos.',
  'MSG-02': 'Este dado (E-mail/CPF/CRM) já pertence a uma conta ativa.',
  'MSG-03': 'Conta bloqueada temporariamente. Tente novamente em 15 minutos.',
  'MSG-04': 'Biometria não reconhecida. Insira o PIN enviado ao seu e-mail.',
  'MSG-05':
    'Se o e-mail constar em nossa base, um link de redefinição será enviado.',
  'MSG-06': 'Link de redefinição inválido ou expirado.',
  'MSG-07': 'Cadastro realizado com sucesso!',
  'MSG-08': 'Senha atualizada com sucesso!',
  'MSG-09': 'Candidatura enviada com sucesso! Acompanhe o status na sua agenda.',
  'MSG-10':
    'Conflito de agenda: você já possui um plantão confirmado neste horário.',
  'MSG-11': 'Check-in registrado com sucesso. Bom plantão!',
  'MSG-12': 'Check-in registrado sem localização (GPS negado).',
  'MSG-13': 'Perfil atualizado. Sua taxa de completude subiu!',
  'MSG-14':
    'Plantão publicado com sucesso! A vaga já está visível para os médicos.',
  'MSG-15': 'Preencha todos os campos obrigatórios para publicar a vaga.',
  'MSG-16': 'A data e hora de fim não podem ser anteriores à data e hora de início.',
  'MSG-17': 'Médico alocado com sucesso! Os demais candidatos foram notificados.',
  'MSG-18': 'Comprovante anexado e status financeiro atualizado para "Pago".',
} as const

export type CodigoMensagem = keyof typeof mensagensOficiais

export function codigoDaMensagem(mensagem: string): CodigoMensagem | null {
  for (const [codigo, oficial] of Object.entries(mensagensOficiais)) {
    if (oficial === mensagem) return codigo as CodigoMensagem
  }
  return null
}
