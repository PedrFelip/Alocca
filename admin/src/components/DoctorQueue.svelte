<script lang="ts">
  import {
    Search,
    ArrowRight,
    RefreshCw,
    Stethoscope,
    ChevronLeft,
    ChevronRight,
    Inbox,
    LoaderCircle,
  } from "lucide-svelte";
  import type { MedicoPendente } from "../lib/types";
  let {
    medicos,
    loading,
    error,
    onReload,
    onReview,
    compact = false,
  }: {
    medicos: MedicoPendente[];
    loading: boolean;
    error: string;
    onReload: () => void;
    onReview: (medico: MedicoPendente) => void;
    compact?: boolean;
  } = $props();
  let search = $state("");
  let uf = $state("");
  let page = $state(1);
  const pageSize = 8;
  let estados = $derived(
    [...new Set(medicos.map((medico) => medico.uf_crm))].sort(),
  );
  let filtered = $derived(
    medicos
      .filter(
        (medico) =>
          (!uf || medico.uf_crm === uf) &&
          `${medico.nome} ${medico.email} ${medico.crm} ${medico.especialidade_declarada || ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.toLocaleLowerCase("pt-BR")),
      )
      .sort((a, b) => Date.parse(a.criado_at) - Date.parse(b.criado_at)),
  );
  let totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  let activePage = $derived(Math.min(page, totalPages));
  let visible = $derived(
    compact
      ? filtered.slice(0, 5)
      : filtered.slice((activePage - 1) * pageSize, activePage * pageSize),
  );
  function initials(nome: string): string {
    return nome
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("");
  }
</script>

<section class="panel queue-panel" aria-labelledby="queue-title">
  <div class="panel-heading">
    <div>
      <h2 id="queue-title">
        {compact
          ? "Próximos cadastros para analisar"
          : "Cadastros pendentes"}<span class="count-badge"
          >{medicos.length}</span
        >
      </h2>
      <p>Confira os dados profissionais antes de liberar o cadastro.</p>
    </div>
    <button class="button secondary small" onclick={onReload} disabled={loading}
      ><RefreshCw size={15} class={loading ? "spin" : ""} />Atualizar</button
    >
  </div>
  {#if !compact}<div class="queue-filters">
      <div class="search-field">
        <Search size={18} /><input
          aria-label="Buscar médico por nome, email ou CRM"
          placeholder="Buscar por nome, e-mail ou CRM…"
          bind:value={search}
          oninput={() => (page = 1)}
        />
      </div>
      <select
        aria-label="Filtrar por UF do CRM"
        bind:value={uf}
        onchange={() => (page = 1)}
        ><option value="">Todos os estados</option
        >{#each estados as estado}<option value={estado}>{estado}</option
          >{/each}</select
      >
    </div>{/if}
  {#if error}<div class="queue-message">
      <div class="alert error" role="alert">{error}</div>
      <button class="button secondary" onclick={onReload}
        >Tentar novamente</button
      >
    </div>
  {:else if loading && !medicos.length}<div class="empty-state" role="status">
      <LoaderCircle size={28} class="spin" />
      <h3>Buscando cadastros</h3>
      <p>A fila será exibida em instantes.</p>
    </div>
  {:else if !visible.length}<div class="empty-state">
      <span class="empty-icon"
        >{#if medicos.length}<Search size={25} />{:else}<Inbox
            size={25}
          />{/if}</span
      >
      <h3>
        {medicos.length ? "Nenhum cadastro encontrado" : "Tudo em dia por aqui"}
      </h3>
      <p>
        {medicos.length
          ? "Tente outro nome, CRM ou estado."
          : "Novos cadastros de médicos aparecerão nesta fila."}
      </p>
    </div>
  {:else}<div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>Médico</th><th>CRM / UF</th><th>Especialidade declarada</th><th
              >Recebido em</th
            ><th><span class="sr-only">Ações</span></th></tr
          ></thead
        ><tbody
          >{#each visible as medico (medico.medico_id)}<tr
              ><td
                ><div class="doctor-cell">
                  <span class="avatar">{initials(medico.nome)}</span>
                  <div>
                    <strong>{medico.nome}</strong><span>{medico.email}</span>
                  </div>
                </div></td
              ><td
                ><span class="crm-text"
                  >{medico.crm}<span class="uf-tag">{medico.uf_crm}</span></span
                ></td
              ><td
                ><span class="specialty"
                  ><Stethoscope size={14} />{medico.especialidade_declarada ||
                    "Não informada"}</span
                ></td
              ><td class="date-cell"
                >{new Intl.DateTimeFormat("pt-BR").format(
                  new Date(medico.criado_at),
                )}</td
              ><td
                ><button
                  class="review-button"
                  onclick={() => onReview(medico)}
                  disabled={loading}>Analisar <ArrowRight size={15} /></button
                ></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  {/if}
  {#if !compact && filtered.length > 0 && !error}<div class="table-footer">
      <span
        >{filtered.length} cadastro{filtered.length === 1 ? "" : "s"} · Mais antigos
        primeiro</span
      >
      <div class="pagination">
        <button
          class="icon-button"
          aria-label="Página anterior"
          disabled={activePage <= 1}
          onclick={() => (page = activePage - 1)}
          ><ChevronLeft size={17} /></button
        ><span>{activePage} de {totalPages}</span><button
          class="icon-button"
          aria-label="Próxima página"
          disabled={activePage >= totalPages}
          onclick={() => (page = activePage + 1)}
          ><ChevronRight size={17} /></button
        >
      </div>
    </div>{/if}
</section>
