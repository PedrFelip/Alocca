export interface Usuario {
  id: string;
  nome: string;
  email: string;
  tipo: "ADMIN" | "GESTOR" | "MEDICO";
  status: "ATIVO" | "INATIVO" | "BLOQUEADO";
}

export interface MedicoPendente {
  medico_id: string;
  usuario_id: string;
  nome: string;
  email: string;
  crm: string;
  uf_crm: string;
  especialidade_declarada: string | null;
  criado_at: string;
}

export interface LoginResponse {
  access_token: string;
  expires_in: number;
  usuario: Usuario;
}

export type Decisao = {
  nome: string;
  crm: string;
  uf_crm: string;
} & (
  | { status_validacao: "APROVADO" }
  | { status_validacao: "REJEITADO"; motivo_rejeicao: string }
);

export type Pagina = "resumo" | "medicos";
