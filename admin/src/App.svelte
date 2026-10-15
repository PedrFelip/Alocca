<script lang="ts">
  import { onMount } from "svelte";
  import {
    ArrowRight,
    ArrowUpRight,
    Clock3,
    LogOut,
    Menu,
    ShieldCheck,
    Stethoscope,
    MapPin,
    X,
    CheckCircle2,
    LoaderCircle,
    CircleHelp,
  } from "lucide-svelte";
  import LoginForm from "./components/LoginForm.svelte";
  import DoctorQueue from "./components/DoctorQueue.svelte";
  import ReviewDialog from "./components/ReviewDialog.svelte";
  import { api, ApiError } from "./lib/api";
  import { navigation } from "./lib/navigation";
  import { clearSession, readSession, saveSession } from "./lib/session";
  import type { Decisao, MedicoPendente, Pagina, Usuario } from "./lib/types";

  let usuario = $state<Usuario | null>(null);
  let token = $state("");
  let expiresAt = $state(0);
  let restoring = $state(true);
  let loading = $state(false);
  let medicos = $state<MedicoPendente[]>([]);
  let error = $state("");
  let notice = $state("");
  let toast = $state("");
  let selected = $state<MedicoPendente | null>(null);
  let pagina = $state<Pagina>("resumo");
  let menuOpen = $state(false);
  let lastUpdated = $state<Date | null>(null);
  let overdue = $derived(
    medicos.filter(
      (medico) =>
        Date.now() - Date.parse(medico.criado_at) > 48 * 60 * 60 * 1000,
    ).length,
  );
  let states = $derived(new Set(medicos.map((medico) => medico.uf_crm)).size);
  let avatar = $derived(
    usuario?.nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("") || "AD",
  );

  function navigate(next: Pagina) {
    pagina = next;
    window.location.hash = next;
    menuOpen = false;
  }
  function logout(message = "") {
    clearSession();
    token = "";
    expiresAt = 0;
    usuario = null;
    medicos = [];
    selected = null;
    error = "";
    toast = "";
    notice = message;
  }
  async function reload() {
    const currentToken = token;
    if (!currentToken) return;
    loading = true;
    error = "";
    try {
      const result = await api.pendentes(currentToken);
      if (token !== currentToken) return;
      medicos = result;
      lastUpdated = new Date();
    } catch (cause) {
      if (token !== currentToken) return;
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) {
        logout(
          "Sua sessão expirou ou seu acesso foi alterado. Entre novamente.",
        );
      } else
        error =
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar os cadastros.";
    } finally {
      if (token === currentToken) loading = false;
    }
  }
  async function login(email: string, senha: string) {
    const result = await api.login(email, senha);
    if (result.usuario.tipo !== "ADMIN" || result.usuario.status !== "ATIVO")
      throw new Error("Este painel é exclusivo para administradores ativos.");
    usuario = result.usuario;
    token = result.access_token;
    expiresAt = Date.now() + result.expires_in * 1000;
    notice = "";
    saveSession({ token, expiresAt });
    void reload();
  }
  async function decide(medico: MedicoPendente, decisao: Decisao) {
    const currentToken = token;
    try {
      await api.decidir(currentToken, medico.medico_id, decisao);
      if (token !== currentToken) return;
      medicos = medicos.filter((item) => item.medico_id !== medico.medico_id);
      toast = `${medico.nome}: cadastro ${decisao.status_validacao === "APROVADO" ? "aprovado" : "rejeitado"}.`;
      lastUpdated = new Date();
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403].includes(cause.status))
        logout(
          "Sua sessão expirou ou seu acesso foi alterado. Entre novamente.",
        );
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
        await reload();
        throw new Error(
          `${cause.message}. Feche esta análise e confira novamente a fila atualizada.`,
        );
      }
      throw cause;
    }
  }
  $effect(() => {
    if (!token || !expiresAt) return;
    const timer = window.setTimeout(
      () => logout("Sua sessão expirou. Entre novamente para continuar."),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  });
  onMount(() => {
    const syncHash = () => {
      pagina = window.location.hash === "#medicos" ? "medicos" : "resumo";
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    const session = readSession();
    if (!session) restoring = false;
    else {
      token = session.token;
      expiresAt = session.expiresAt;
      const savedToken = session.token;
      api
        .perfil(savedToken)
        .then((profile) => {
          if (token !== savedToken) return;
          if (profile.tipo !== "ADMIN" || profile.status !== "ATIVO") {
            logout("Sua conta não tem acesso administrativo.");
            return;
          }
          usuario = profile;
          void reload();
        })
        .catch((cause) => {
          logout(
            cause instanceof ApiError && cause.status === 0
              ? cause.message
              : "Entre novamente para acessar o painel.",
          );
        })
        .finally(() => (restoring = false));
    }
    return () => window.removeEventListener("hashchange", syncHash);
  });
</script>

{#if restoring}<div class="boot-screen" role="status">
    <LoaderCircle size={24} class="spin" />
    <p>Preparando seu painel…</p>
  </div>
{:else if !usuario}<LoginForm onLogin={login} {notice} />
{:else}
  <div class="admin-layout">
    <aside
      class:mobile-open={menuOpen}
      class="sidebar"
      aria-label="Menu administrativo"
    >
      <div class="workspace-label">
        <span class="workspace-dot"></span>Administração<span
          class="workspace-tag">ADMIN</span
        >
      </div>
      <div class="nav-label">PRINCIPAL</div>
      <nav>
        {#each navigation as item}{#if item.available}<button
              class:active={pagina === item.id}
              aria-current={pagina === item.id ? "page" : undefined}
              onclick={() => navigate(item.id as Pagina)}
              ><item.icon
                size={19}
              />{item.label}{#if item.id === "medicos" && medicos.length}<span
                  class="nav-count">{medicos.length}</span
                >{/if}</button
            >{:else}<button class="future-nav" disabled title="Módulo planejado"
              ><item.icon size={19} />{item.label}<span class="soon"
                >Em breve</span
              ></button
            >{/if}{/each}
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <ShieldCheck size={24} /><strong>Uma rede de confiança.</strong>
          <p>
            Cada cadastro conferido é um passo para uma operação mais segura.
          </p>
        </div>
        <div class="user-profile">
          <span class="avatar sidebar-avatar">{avatar}</span>
          <div><strong>{usuario.nome}</strong><span>Administrador</span></div>
          <button
            class="icon-button"
            aria-label="Sair do painel"
            title="Sair do painel"
            onclick={() => logout()}><LogOut size={18} /></button
          >
        </div>
      </div>
    </aside>
    {#if menuOpen}<button
        class="mobile-overlay"
        aria-label="Fechar menu"
        onclick={() => (menuOpen = false)}
      ></button>{/if}
    <div class="main-area">
      <main>
        <button
          class="icon-button mobile-menu"
          aria-label="Abrir menu"
          onclick={() => (menuOpen = true)}><Menu size={22} /></button
        >
        {#if toast}<div class="toast" role="status">
            <CheckCircle2 size={19} /><span>{toast}</span><button
              class="icon-button"
              aria-label="Fechar mensagem"
              onclick={() => (toast = "")}><X size={17} /></button
            >
          </div>{/if}
        <div class="page-heading">
          <div>
            <span class="eyebrow"
              >{pagina === "resumo"
                ? "SUA OPERAÇÃO, EM UM SÓ LUGAR"
                : "PESSOAS QUE FAZEM A DIFERENÇA"}</span
            >
            <h1>
              {pagina === "resumo"
                ? "Visão geral"
                : "Validação de médicos"}<span class="title-dot">.</span>
            </h1>
            <p>
              {pagina === "resumo"
                ? "Acompanhe os cadastros e prepare sua rede para os próximos plantões."
                : "Confira cada cadastro e construa uma rede de profissionais verificados."}
            </p>
          </div>
          <span class="page-date"
            >{new Intl.DateTimeFormat("pt-BR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }).format(new Date())}</span
          >
        </div>
        {#if pagina === "resumo"}
          <div class="stats-grid">
            <article class="stat-card">
              <div class="stat-heading">
                <span>Cadastros pendentes</span><span class="stat-icon"
                  ><Stethoscope size={20} /></span
                >
              </div>
              <strong class="stat-value"
                >{(loading && !lastUpdated) || error
                  ? "—"
                  : medicos.length}</strong
              >
              <p><span class="mini-dot amber"></span>Aguardando sua análise</p>
            </article>
            <article class="stat-card">
              <div class="stat-heading">
                <span>Aguardando há mais de 48h</span><span
                  class="stat-icon neutral"><Clock3 size={20} /></span
                >
              </div>
              <strong class="stat-value"
                >{(loading && !lastUpdated) || error ? "—" : overdue}</strong
              >
              <p>Priorize os cadastros mais antigos</p>
            </article>
            <article class="stat-card">
              <div class="stat-heading">
                <span>Estados na fila</span><span class="stat-icon neutral"
                  ><MapPin size={20} /></span
                >
              </div>
              <strong class="stat-value"
                >{(loading && !lastUpdated) || error ? "—" : states}</strong
              >
              <p>UFs dos registros recebidos</p>
            </article>
          </div>
          <section class="action-banner">
            <div class="banner-icon"><ShieldCheck size={29} /></div>
            <div>
              <span class="eyebrow">O PRÓXIMO PASSO</span>
              <h2>Uma boa rede começa com uma boa conferência.</h2>
              <p>
                Analise o registro e a identidade de cada profissional antes de
                aprovar.
              </p>
            </div>
            <button class="button primary" onclick={() => navigate("medicos")}
              >Analisar cadastros <ArrowRight size={17} /></button
            >
          </section>
          <DoctorQueue
            {medicos}
            {loading}
            {error}
            onReload={reload}
            onReview={(medico) => (selected = medico)}
            compact
          />
          <div class="dashboard-bottom">
            <span
              ><CircleHelp size={15} /> A conferência profissional é feita no portal
              oficial do CFM.</span
            ><button class="text-button" onclick={() => navigate("medicos")}
              >Ver todos os cadastros <ArrowRight size={15} /></button
            >
          </div>
        {:else}<div class="section-note">
            <ShieldCheck size={18} /><span
              >Aprovação manual · Consulte o CRM e confirme a identidade do
              solicitante.</span
            ><a
              href="https://portal.cfm.org.br/busca-medicos"
              target="_blank"
              rel="noopener noreferrer"
              >Abrir busca CFM <ArrowUpRight size={15} /></a
            >
          </div>
          <DoctorQueue
            {medicos}
            {loading}
            {error}
            onReload={reload}
            onReview={(medico) => (selected = medico)}
          />{/if}
        <footer class="main-footer">
          <span>Alocca · Administração</span><span
            >{lastUpdated
              ? `Fila atualizada às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(lastUpdated)}`
              : "Acompanhamento de cadastros"}</span
          >
        </footer>
      </main>
    </div>
  </div>
  {#if selected}<ReviewDialog
      medico={selected}
      onClose={() => (selected = null)}
      onDecision={decide}
    />{/if}
{/if}
