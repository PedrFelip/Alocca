import { ZodValidationPipe } from '../common/zod-validation.pipe.ts'
import { cadastroMedicoSchema } from './usuarios.schemas.ts'

const base = {
  nome: 'Dra. Maria',
  cpf: '529.982.247-25',
  email: 'maria@example.com',
  senha: 'Senha-Segura-123',
  crm: '123456',
  uf_crm: 'SP',
}

function medicoCorpo(sobrescrever: Partial<typeof base>) {
  return new ZodValidationPipe(cadastroMedicoSchema).transform({
    ...base,
    ...sobrescrever,
  })
}

describe('Schema de cadastro de médico', () => {
  it('higieniza o CPF e normaliza e-mail e UF (RN04/RN01)', () => {
    expect(
      medicoCorpo({ cpf: '529.982.247-25', email: ' Maria@Example.COM ' }),
    ).toMatchObject({
      cpf: '52998224725',
      email: 'maria@example.com',
      uf_crm: 'SP',
    })
  })

  it('valida o CPF pelo dígito verificador e rejeita repetidos (RN02)', () => {
    expect(() => medicoCorpo({ cpf: '529.982.247-24' })).toThrow()
    expect(() => medicoCorpo({ cpf: '123.456.789-00' })).toThrow()
    expect(() => medicoCorpo({ cpf: '111.111.111-11' })).toThrow()
    expect(() => medicoCorpo({ cpf: '5299822472' })).toThrow()
    expect(() => medicoCorpo({ cpf: '' })).toThrow()
  })

  it('exige senha com maiúscula, minúscula e número (RN05)', () => {
    for (const senha of [
      'curta123', // sem maiúscula
      'semnumero-AA', // sem número
      'SEMCAIXABAIXA1', // sem minúscula
      'Senha-QR', // menos de 8 caracteres
    ]) {
      expect(() => medicoCorpo({ senha })).toThrow()
    }
  })
})
