<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type {
    CharacterSummary,
    LogEntry,
    PreviewAsset,
    RuntimeConfig,
    RuntimeStatus,
    ServiceStatus,
  } from './types';

  type Section = 'overview' | 'settings' | 'logs' | 'system';

  const appWindow = getCurrentWindow();
  let section: Section = 'overview';
  let runtime: RuntimeStatus | null = null;
  let service: ServiceStatus = {
    installed: false,
    active: false,
    state: 'unknown',
    sub_state: 'unknown',
    pid: 0,
    restarts: 0,
    autostart: false,
  };
  let config: RuntimeConfig = {
    character: 'amiya',
    variant: 'default',
    scale: 1,
    speed: 1,
    auto_move: true,
    click_through: false,
    monitor: 0,
    verbose: true,
  };
  let characters: CharacterSummary[] = [];
  let logs: LogEntry[] = [];
  let preview: PreviewAsset | null = null;
  let previewFrame = 0;
  let previewTimer: number | undefined;
  let loading = true;
  let saving = false;
  let notice = '正在连接桌宠运行时…';
  let noticeKind: 'info' | 'ok' | 'error' = 'info';
  let logFilter = '';

  $: selectedCharacter = characters.find((entry) => entry.id === config.character);
  $: variants = selectedCharacter?.variants ?? [];
  $: visibleLogs = logFilter.trim()
    ? logs.filter((entry) => entry.message.toLowerCase().includes(logFilter.trim().toLowerCase()))
    : logs;
  $: previewSourceFrame = preview?.frames[previewFrame % Math.max(1, preview.frames.length)] ?? 0;
  $: previewColumn = preview ? previewSourceFrame % preview.columns : 0;
  $: previewRow = preview ? Math.floor(previewSourceFrame / preview.columns) : 0;
  $: previewStyle = preview
    ? `background-image:url("${preview.data_url}");background-size:${preview.columns * 100}% ${preview.rows * 100}%;background-position:${preview.columns > 1 ? (previewColumn / (preview.columns - 1)) * 100 : 0}% ${preview.rows > 1 ? (previewRow / (preview.rows - 1)) * 100 : 0}%`
    : '';

  function notify(message: string, kind: 'info' | 'ok' | 'error' = 'info') {
    notice = message;
    noticeKind = kind;
  }

  async function refreshStatus(silent = false) {
    try {
      service = await invoke<ServiceStatus>('service_status');
      runtime = service.active ? await invoke<RuntimeStatus>('runtime_status') : null;
      if (!silent) notify(runtime ? '运行时连接正常' : '桌宠服务当前未运行', runtime ? 'ok' : 'info');
    } catch (error) {
      runtime = null;
      if (!silent) notify(String(error), 'error');
    }
  }

  async function refreshLogs() {
    if (section !== 'logs') return;
    try {
      logs = await invoke<LogEntry[]>('read_logs', { limit: 180 });
    } catch (error) {
      notify(`日志读取失败：${String(error)}`, 'error');
    }
  }

  async function loadPreview() {
    if (!config.character || !config.variant) return;
    try {
      preview = await invoke<PreviewAsset>('preview_asset', {
        character: config.character,
        variant: config.variant,
      });
      previewFrame = 0;
      if (previewTimer !== undefined) clearInterval(previewTimer);
      previewTimer = window.setInterval(() => {
        if (preview?.frames.length) previewFrame = (previewFrame + 1) % preview.frames.length;
      }, Math.max(60, Math.round(1000 / Math.max(1, preview.fps))));
    } catch {
      preview = null;
    }
  }

  async function serviceAction(action: 'start' | 'stop' | 'restart') {
    try {
      notify(`${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}请求已发送…`);
      await invoke('service_action', { action });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await refreshStatus();
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  async function save(restart = false) {
    saving = true;
    try {
      runtime = await invoke<RuntimeStatus | null>('save_config', { config, restart });
      notify(restart ? '配置已保存并重启服务' : '配置已保存并实时应用', 'ok');
      service = await invoke<ServiceStatus>('service_status');
    } catch (error) {
      notify(String(error), 'error');
    } finally {
      saving = false;
    }
  }

  async function toggleAutostart() {
    try {
      service = await invoke<ServiceStatus>('set_autostart', { enabled: !service.autostart });
      notify(service.autostart ? '已启用登录时启动' : '已关闭登录时启动', 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  function characterChanged() {
    const character = characters.find((entry) => entry.id === config.character);
    if (character) config.variant = character.default_variant_id;
    void loadPreview();
  }

  onMount(() => {
    let cancelled = false;
    Promise.all([
      invoke<CharacterSummary[]>('list_characters'),
      invoke<RuntimeConfig>('load_config'),
    ]).then(async ([registry, saved]) => {
      if (cancelled) return;
      config = saved;
      characters = registry;
      await loadPreview();
      await refreshStatus();
      loading = false;
    }).catch((error) => {
      loading = false;
      notify(String(error), 'error');
    });
    const statusTimer = window.setInterval(() => refreshStatus(true), 1500);
    const logTimer = window.setInterval(refreshLogs, 1400);
    return () => {
      cancelled = true;
      clearInterval(statusTimer);
      clearInterval(logTimer);
      if (previewTimer !== undefined) clearInterval(previewTimer);
    };
  });
</script>

<div class="app-shell">
  <header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="brand-mark">PA</span>
      <div data-tauri-drag-region>
        <strong>PET ARK</strong>
        <small>WAYLAND CONTROL TERMINAL</small>
      </div>
    </div>
    <div class="title-status" data-tauri-drag-region>
      <span class:online={service.active} class="status-dot"></span>
      <span>{service.active ? 'LINK ACTIVE' : 'LINK OFFLINE'}</span>
      {#if runtime}<code>PID {runtime.pid}</code>{/if}
    </div>
    <div class="window-controls">
      <button aria-label="最小化" onclick={() => appWindow.minimize()}>—</button>
      <button class="close" aria-label="关闭" onclick={() => appWindow.close()}>×</button>
    </div>
  </header>

  <aside class="sidebar">
    <div class="section-label">CONTROL INDEX</div>
    <nav>
      <button class:active={section === 'overview'} onclick={() => section = 'overview'}><span>01</span>运行总览</button>
      <button class:active={section === 'settings'} onclick={() => section = 'settings'}><span>02</span>桌宠设置</button>
      <button class:active={section === 'logs'} onclick={() => { section = 'logs'; refreshLogs(); }}><span>03</span>运行日志</button>
      <button class:active={section === 'system'} onclick={() => section = 'system'}><span>04</span>服务管理</button>
    </nav>
    <div class="sidebar-meta">
      <span>PROTOCOL</span><strong>LOCAL/JSON</strong>
      <span>COMPOSITOR</span><strong>{runtime?.shell ?? '—'}</strong>
      <span>OUTPUTS</span><strong>{runtime?.outputs ?? '—'}</strong>
    </div>
  </aside>

  <main>
    <div class="notice {noticeKind}"><span></span>{notice}</div>

    {#if loading}
      <section class="loading-panel">
        <div class="loader-ring"></div>
        <h2>正在建立神经连接</h2>
        <p>同步角色注册表、服务状态与运行时配置</p>
      </section>
    {:else if section === 'overview'}
      <section class="page enter">
        <div class="page-heading">
          <div><span class="eyebrow">OPERATION / 01</span><h1>运行总览</h1></div>
          <button class="ghost" onclick={() => refreshStatus()}>刷新状态</button>
        </div>
        <div class="metrics-grid">
          <article class="metric accent"><span>服务状态</span><strong>{service.active ? '运行中' : '已停止'}</strong><small>{service.sub_state}</small></article>
          <article class="metric"><span>当前干员</span><strong>{selectedCharacter?.localized_name ?? runtime?.character ?? '—'}</strong><small>{runtime?.variant ?? config.variant}</small></article>
          <article class="metric"><span>行为状态</span><strong>{runtime?.behavior ?? 'OFFLINE'}</strong><small>{runtime?.animation ?? 'no signal'}</small></article>
          <article class="metric"><span>服务重启</span><strong>{service.restarts}</strong><small>本次服务周期</small></article>
        </div>
        <div class="dashboard-grid">
          <article class="operator-card panel-cut">
            <div class="operator-backdrop"><span>ARK</span><span>01</span></div>
            {#if preview}
              <div class="operator-preview" style={previewStyle} aria-label="当前干员 idle 动画预览"></div>
            {:else}
              <div class="operator-silhouette"><div class="ear left"></div><div class="ear right"></div><div class="head"></div><div class="body"></div></div>
            {/if}
            <div class="operator-copy">
              <span class="tag">CURRENT OPERATOR</span>
              <h2>{selectedCharacter?.localized_name ?? '阿米娅'}</h2>
              <p>{selectedCharacter?.name ?? 'Amiya'} / {runtime?.variant ?? config.variant}</p>
            </div>
          </article>
          <article class="telemetry-card">
            <div class="card-title"><span>LIVE TELEMETRY</span><small>1.5 SEC REFRESH</small></div>
            <div class="telemetry-row"><span>显示比例</span><strong>{(runtime?.scale ?? config.scale).toFixed(2)}×</strong><i style={`--value:${((runtime?.scale ?? config.scale) / 3) * 100}%`}></i></div>
            <div class="telemetry-row"><span>移动速度</span><strong>{(runtime?.speed ?? config.speed).toFixed(2)}×</strong><i style={`--value:${((runtime?.speed ?? config.speed) / 5) * 100}%`}></i></div>
            <div class="telemetry-row binary"><span>自动移动</span><strong>{runtime?.auto_move ? 'ON' : 'OFF'}</strong></div>
            <div class="telemetry-row binary"><span>点击穿透</span><strong>{runtime?.click_through ? 'ON' : 'OFF'}</strong></div>
            <div class="action-row">
              <button class="primary" onclick={() => serviceAction(service.active ? 'restart' : 'start')}>{service.active ? '重启桌宠' : '启动桌宠'}</button>
              {#if service.active}<button class="danger-soft" onclick={() => serviceAction('stop')}>停止</button>{/if}
            </div>
          </article>
        </div>
      </section>
    {:else if section === 'settings'}
      <section class="page enter">
        <div class="page-heading"><div><span class="eyebrow">CONFIGURATION / 02</span><h1>桌宠设置</h1></div><span class="save-state">{saving ? '正在同步…' : '实时控制可用'}</span></div>
        <div class="settings-grid">
          <article class="settings-card wide">
            <div class="card-title"><span>角色与外观</span><small>{characters.length} OPERATORS</small></div>
            <div class="field-grid">
              <label><span>干员</span><select bind:value={config.character} onchange={characterChanged}>{#each characters as character}<option value={character.id}>{character.localized_name} / {character.name}</option>{/each}</select></label>
              <label><span>外观</span><select bind:value={config.variant} onchange={() => loadPreview()}>{#each variants as variant}<option value={variant.id}>{variant.localized_name} / {variant.id}</option>{/each}</select></label>
            </div>
          </article>
          <article class="settings-card">
            <div class="card-title"><span>运动参数</span><small>LIVE</small></div>
            <label class="range-field"><span>显示大小 <b>{config.scale.toFixed(2)}×</b></span><input type="range" min="0.25" max="3" step="0.05" bind:value={config.scale} /></label>
            <label class="range-field"><span>移动速度 <b>{config.speed.toFixed(2)}×</b></span><input type="range" min="0.1" max="5" step="0.05" bind:value={config.speed} /></label>
          </article>
          <article class="settings-card">
            <div class="card-title"><span>行为策略</span><small>RUNTIME</small></div>
            <label class="switch-row"><span><b>自动移动</b><small>空闲后在当前输出内巡游</small></span><input type="checkbox" bind:checked={config.auto_move} /><i></i></label>
            <label class="switch-row"><span><b>点击穿透</b><small>允许指针穿过桌宠可见区域</small></span><input type="checkbox" bind:checked={config.click_through} /><i></i></label>
          </article>
          <article class="settings-card wide compact">
            <label><span>显示器编号</span><input type="number" min="0" max="15" bind:value={config.monitor} /></label>
            <div class="settings-actions"><button class="ghost" onclick={() => save(true)} disabled={saving}>保存并重启</button><button class="primary" onclick={() => save(false)} disabled={saving}>立即应用</button></div>
          </article>
        </div>
      </section>
    {:else if section === 'logs'}
      <section class="page logs-page enter">
        <div class="page-heading"><div><span class="eyebrow">DIAGNOSTICS / 03</span><h1>运行日志</h1></div><button class="ghost" onclick={refreshLogs}>立即刷新</button></div>
        <div class="log-toolbar"><input placeholder="筛选日志内容…" bind:value={logFilter} /><span>{visibleLogs.length} RECORDS</span></div>
        <div class="log-console">
          {#if visibleLogs.length === 0}<div class="empty">当前没有匹配日志</div>{/if}
          {#each visibleLogs as entry}
            <div class:error={entry.priority <= 3} class:warning={entry.priority === 4} class="log-line"><time>{entry.timestamp}</time><span>P{entry.priority}</span><p>{entry.message}</p></div>
          {/each}
        </div>
      </section>
    {:else}
      <section class="page enter">
        <div class="page-heading"><div><span class="eyebrow">SERVICE / 04</span><h1>服务管理</h1></div></div>
        <div class="service-layout">
          <article class="service-card hero-service">
            <span class:online={service.active} class="service-beacon"></span>
            <div><small>PET-ARK.SERVICE</small><h2>{service.active ? 'SYSTEM NOMINAL' : 'SERVICE OFFLINE'}</h2><p>{service.state} / {service.sub_state} · PID {service.pid || '—'}</p></div>
          </article>
          <article class="service-card">
            <div class="card-title"><span>进程控制</span><small>USER SERVICE</small></div>
            <div class="service-buttons"><button onclick={() => serviceAction('start')} disabled={service.active}>启动</button><button onclick={() => serviceAction('restart')} disabled={!service.active}>重启</button><button class="danger-soft" onclick={() => serviceAction('stop')} disabled={!service.active}>停止</button></div>
          </article>
          <article class="service-card">
            <div class="card-title"><span>登录行为</span><small>DISABLED BY DEFAULT</small></div>
            <label class="switch-row"><span><b>登录时启动</b><small>进入用户桌面会话后启动，不等同于系统开机</small></span><input type="checkbox" checked={service.autostart} onchange={toggleAutostart} /><i></i></label>
          </article>
          <article class="service-card path-card"><span>CONFIG</span><code>~/.config/pet-ark/runtime.env</code><span>CONTROL</span><code>$XDG_RUNTIME_DIR/pet-ark/control.sock</code></article>
        </div>
      </section>
    {/if}
  </main>

  <footer><span>PET ARK CONTROL CENTER</span><span>LOCAL AUTHORITY // NO NETWORK</span><span>BUILD 0.1.0</span></footer>
</div>
