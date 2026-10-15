const key = "alocca.admin.session";
export interface Session {
  token: string;
  expiresAt: number;
}

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const session: Session = JSON.parse(raw);
    if (
      typeof session.token !== "string" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Date.now()
    ) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    /* A sessão em memória continua disponível. */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* O armazenamento pode estar indisponível. */
  }
}
