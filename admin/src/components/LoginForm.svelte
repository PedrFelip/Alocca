<script lang="ts">
  import {
    ArrowUpRight,
    ShieldCheck,
    Stethoscope,
    Eye,
    EyeOff,
    ArrowRight,
    LoaderCircle,
  } from "lucide-svelte";
  let {
    onLogin,
    notice = "",
  }: {
    onLogin: (email: string, senha: string) => Promise<void>;
    notice?: string;
  } = $props();
  let email = $state("");
  let senha = $state("");
  let visible = $state(false);
  let busy = $state(false);
  let error = $state("");
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = "";
    try {
      await onLogin(email.trim(), senha);
    } catch (cause) {
      error =
        cause instanceof Error ? cause.message : "Não foi possível entrar.";
    } finally {
      busy = false;
      senha = "";
    }
  }
</script>

<div class="login-page">
  <section class="login-story">
    <div class="story-copy">
      <span class="eyebrow light">CUIDADO COMEÇA COM CONFIANÇA</span>
      <h1>Quem cuida merece<br />estar no lugar certo.</h1>
      <p>
        Conectamos médicos e instituições para que cada plantão aconteça com
        mais organização e segurança.
      </p>
      <div class="story-badge">
        <ShieldCheck size={21} /> Um espaço para cuidar da operação.
      </div>
    </div>
    <div class="story-footer">
      <span>Administração Alocca</span><span
        >Gestão com propósito <ArrowUpRight size={16} /></span
      >
    </div>
    <div class="story-decoration" aria-hidden="true">
      <Stethoscope size={230} strokeWidth={0.8} />
    </div>
  </section>
  <section class="login-main">
    <div class="login-card">
      <span class="pill"><ShieldCheck size={15} /> ACESSO ADMINISTRATIVO</span>
      <h2>Bom ter você aqui.</h2>
      <p class="muted">
        Entre para acompanhar a operação e analisar os cadastros de médicos.
      </p>
      {#if error || notice}<div class="alert error" role="alert">
          {error || notice}
        </div>{/if}
      <form onsubmit={submit}>
        <label for="email">E-mail</label><input
          id="email"
          name="email"
          type="email"
          autocomplete="username"
          placeholder="voce@instituicao.com.br"
          bind:value={email}
          required
          disabled={busy}
        />
        <label for="senha">Senha</label>
        <div class="password-input">
          <input
            id="senha"
            name="senha"
            type={visible ? "text" : "password"}
            autocomplete="current-password"
            placeholder="Sua senha"
            bind:value={senha}
            required
            maxlength="128"
            disabled={busy}
          /><button
            type="button"
            class="icon-button"
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
            onclick={() => (visible = !visible)}
            >{#if visible}<EyeOff size={18} />{:else}<Eye
                size={18}
              />{/if}</button
          >
        </div>
        <button
          class="button primary login-submit"
          type="submit"
          disabled={busy}
          >{#if busy}<LoaderCircle class="spin" size={18} /> Entrando…{:else}Entrar
            no painel <ArrowRight size={18} />{/if}</button
        >
      </form>
      <div class="login-note">
        <ShieldCheck size={18} /><span
          >Este painel é exclusivo para administradores. Para solicitar acesso,
          fale com o responsável pelo Alocca.</span
        >
      </div>
    </div>
    <footer class="login-footer">Alocca · Organização para quem cuida.</footer>
  </section>
</div>
