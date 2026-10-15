<script lang="ts">
  import {
    X,
    ArrowUpRight,
    Check,
    Copy,
    LoaderCircle,
    ShieldCheck,
    AlertCircle,
  } from "lucide-svelte";
  import type { Decisao, MedicoPendente } from "../lib/types";
  let {
    medico,
    onClose,
    onDecision,
  }: {
    medico: MedicoPendente;
    onClose: () => void;
    onDecision: (medico: MedicoPendente, decisao: Decisao) => Promise<void>;
  } = $props();
  let dialog: HTMLDialogElement;
  let identity = $state(false);
  let registration = $state(false);
  let rejecting = $state(false);
  let reason = $state("");
  let busy = $state(false);
  let error = $state("");
  let copied = $state(false);
  $effect(() => {
    if (dialog && !dialog.open) dialog.showModal();
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${medico.crm}/${medico.uf_crm}`);
      copied = true;
    } catch {
      error = "Não foi possível copiar. Selecione o CRM abaixo para copiá-lo.";
    }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!rejecting && (!identity || !registration)) return;
    busy = true;
    error = "";
    const decisao: Decisao = rejecting
      ? {
          nome: medico.nome,
          crm: medico.crm,
          uf_crm: medico.uf_crm,
          status_validacao: "REJEITADO",
          motivo_rejeicao: reason.trim(),
        }
      : {
          nome: medico.nome,
          crm: medico.crm,
          uf_crm: medico.uf_crm,
          status_validacao: "APROVADO",
        };
    try {
      await onDecision(medico, decisao);
      onClose();
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause.message
          : "Não foi possível registrar a análise.";
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="review-dialog"
  aria-labelledby="review-title"
  onclose={onClose}
  oncancel={(event) => {
    if (busy) event.preventDefault();
  }}
>
  <header class="dialog-header">
    <div>
      <span class="eyebrow">VALIDAÇÃO DE CADASTRO</span>
      <h2 id="review-title">Analisar médico</h2>
    </div>
    <button
      class="icon-button"
      aria-label="Fechar análise"
      disabled={busy}
      onclick={onClose}><X size={21} /></button
    >
  </header>
  <div class="dialog-content">
    <div class="doctor-identity">
      <span class="avatar large"
        >{medico.nome
          .split(" ")
          .slice(0, 2)
          .map((part) => part[0])
          .join("")}</span
      >
      <div>
        <h3>{medico.nome}</h3>
        <p>{medico.email}</p>
        <span class="status-pill">Aguardando análise</span>
      </div>
    </div>
    <dl class="doctor-details">
      <div>
        <dt>Registro profissional</dt>
        <dd>
          {medico.crm} / {medico.uf_crm}<button
            class="icon-button"
            aria-label="Copiar CRM e UF"
            onclick={copy}
            >{#if copied}<Check size={16} />{:else}<Copy
                size={16}
              />{/if}</button
          >
        </dd>
      </div>
      <div>
        <dt>Especialidade declarada</dt>
        <dd>{medico.especialidade_declarada || "Não informada"}</dd>
      </div>
      <div>
        <dt>Cadastro recebido</dt>
        <dd>
          {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(
            new Date(medico.criado_at),
          )}
        </dd>
      </div>
    </dl>
    <div class="cfm-box">
      <div class="cfm-heading">
        <ShieldCheck size={21} /><strong>Confira no registro oficial</strong>
      </div>
      <p>
        Busque pelo CRM e UF no CFM e confira a situação da inscrição. Verifique
        também se o solicitante é a pessoa do registro.
      </p>
      <a
        class="button secondary"
        href="https://portal.cfm.org.br/busca-medicos"
        target="_blank"
        rel="noopener noreferrer">Consultar CFM <ArrowUpRight size={17} /></a
      ><small>Abre em outra aba. A conferência é feita por você.</small>
    </div>
    <form onsubmit={submit}>
      {#if error}<div class="alert error" role="alert">
          <AlertCircle size={17} />{error}
        </div>{/if}
      {#if rejecting}<label for="reason">Motivo da rejeição</label><textarea
          id="reason"
          rows="4"
          bind:value={reason}
          placeholder="Explique a divergência para que o médico possa corrigir o cadastro."
          minlength="3"
          maxlength="500"
          required
          disabled={busy}></textarea>
        <p class="field-note">Este motivo será exibido ao médico.</p>
      {:else}<h4>Antes de aprovar</h4>
        <label class="checkbox-label"
          ><input
            type="checkbox"
            bind:checked={registration}
            disabled={busy}
          />Confirmei que a inscrição está ativa e corresponde ao CRM/UF
          informado.</label
        ><label class="checkbox-label"
          ><input
            type="checkbox"
            bind:checked={identity}
            disabled={busy}
          />Conferi a identidade do solicitante e sua correspondência com o
          registro.</label
        >
        <p class="field-note">
          A especialidade é declarada. Esta análise não valida o RQE.
        </p>{/if}
      <div class="dialog-actions">
        {#if rejecting}<button
            class="button secondary"
            type="button"
            onclick={() => (rejecting = false)}
            disabled={busy}>Voltar</button
          ><button
            class="button danger"
            type="submit"
            disabled={busy || reason.trim().length < 3}
            >{#if busy}<LoaderCircle class="spin" size={17} />{:else}<X
                size={17}
              />{/if}Confirmar rejeição</button
          >{:else}<button
            class="button secondary"
            type="button"
            onclick={() => {
              rejecting = true;
              error = "";
            }}
            disabled={busy}>Rejeitar cadastro</button
          ><button
            class="button primary"
            type="submit"
            disabled={busy || !identity || !registration}
            >{#if busy}<LoaderCircle class="spin" size={17} />{:else}<Check
                size={17}
              />{/if}Aprovar médico</button
          >{/if}
      </div>
    </form>
  </div>
</dialog>
