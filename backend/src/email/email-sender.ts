export type Email = { para: string; assunto: string; texto: string }

/** Contrato de entrega; SMTP é um adaptador substituível no módulo. */
export abstract class EmailSender {
  abstract enviar(email: Email): Promise<void>
}
