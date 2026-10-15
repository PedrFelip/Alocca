import type { Decisao, LoginResponse, MedicoPendente, Usuario } from "./types";

const baseUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar. Confira se o backend está disponível e tente novamente.",
      0,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let message = "Não foi possível concluir a solicitação.";
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
    )
      message = body.message;
    if (response.status === 429)
      message = "Muitas tentativas. Aguarde um minuto e tente novamente.";
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  login: (email: string, senha: string) =>
    request<LoginResponse>("/auth/login", undefined, {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    }),
  perfil: (token: string) => request<Usuario>("/usuarios/me", token),
  pendentes: (token: string) =>
    request<MedicoPendente[]>("/admin/medicos/pendentes", token),
  decidir: (token: string, id: string, decisao: Decisao) =>
    request<unknown>(
      `/admin/medicos/${encodeURIComponent(id)}/validacao`,
      token,
      { method: "PATCH", body: JSON.stringify(decisao) },
    ),
};
