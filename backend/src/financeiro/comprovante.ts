import { BadRequestException } from '@nestjs/common'
import { MAX_COMPROVANTE } from './comprovantes.storage.ts'

export type ArquivoComprovante = {
  originalname: string
  mimetype: string
  buffer: Buffer
  size: number
}

export function validarComprovante(arquivo?: ArquivoComprovante) {
  const invalido = () =>
    new BadRequestException(
      'Envie um comprovante PDF, JPG ou PNG válido de até 5 MB',
    )
  if (
    !arquivo ||
    !arquivo.buffer?.length ||
    arquivo.buffer.length > MAX_COMPROVANTE ||
    arquivo.size !== arquivo.buffer.length
  )
    throw invalido()
  const extensao = arquivo.originalname.split('.').pop()?.toLowerCase()
  const b = arquivo.buffer
  if (
    extensao === 'pdf' &&
    arquivo.mimetype === 'application/pdf' &&
    b.subarray(0, 5).toString() === '%PDF-' &&
    b.subarray(-1024).includes(Buffer.from('%%EOF'))
  )
    return { extensao: 'pdf', mime: 'application/pdf' }
  if (
    ['jpg', 'jpeg'].includes(extensao ?? '') &&
    arquivo.mimetype === 'image/jpeg' &&
    b[0] === 0xff &&
    b[1] === 0xd8 &&
    b[2] === 0xff &&
    b[b.length - 2] === 0xff &&
    b[b.length - 1] === 0xd9
  )
    return { extensao: 'jpg', mime: 'image/jpeg' }
  if (
    extensao === 'png' &&
    arquivo.mimetype === 'image/png' &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  )
    return { extensao: 'png', mime: 'image/png' }
  throw invalido()
}
