<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import type {
    CharacterSummary,
    LogEntry,
    PetInstance,
    PreviewAsset,
    RuntimeConfig,
    RuntimeStatus,
    ServiceStatus,
  } from './types';

  type Section = 'overview' | 'fleet' | 'settings' | 'logs' | 'system';

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
  let instances: PetInstance[] = [];
  let selectedInstanceId = 'default';
  let newInstanceId = '';
  let newInstanceCharacter = 'amiya';
  let newInstanceVariant = 'default';
  let contextService: ServiceStatus = {
    installed: false,
    active: false,
    state: 'unknown',
    sub_state: 'unknown',
    pid: 0,
    restarts: 0,
    autostart: false,
  };
  let logs: LogEntry[] = [];
  let preview: PreviewAsset | null = null;
  let previewFrame = 0;
  let previewTimer: number | undefined;
  let loading = true;
  let saving = false;
  let notice = '正在连接桌宠运行时…';
  let noticeKind: 'info' | 'ok' | 'error' = 'info';
  let logFilter = '';
  let logConsole: HTMLDivElement;

  $: selectedCharacter = characters.find((entry) => entry.id === config.character);
  $: selectedInstance = instances.find((entry) => entry.id === selectedInstanceId) ?? instances[0];
  $: newInstanceCharacterEntry = characters.find((entry) => entry.id === newInstanceCharacter);
  $: newInstanceVariants = newInstanceCharacterEntry?.variants ?? [];
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
  $: settingsNeedRestart = runtime !== null && config.monitor !== runtime.monitor;

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

  async function refreshFleet(silent = true) {
    try {
      [instances, contextService] = await Promise.all([
        invoke<PetInstance[]>('list_instances'),
        invoke<ServiceStatus>('context_status'),
      ]);
      if (!instances.some((entry) => entry.id === selectedInstanceId)) selectedInstanceId = instances[0]?.id ?? 'default';
    } catch (error) {
      if (!silent) notify(String(error), 'error');
    }
  }

  async function refreshLogs(followLatest = false) {
    if (section !== 'logs') return;
    const wasFollowing = logConsole
      ? logConsole.scrollHeight - logConsole.scrollTop - logConsole.clientHeight < 48
      : true;
    try {
      logs = await invoke<LogEntry[]>('read_logs', { limit: 180, instance: selectedInstanceId });
      await tick();
      if (logConsole && (followLatest || wasFollowing)) logConsole.scrollTop = logConsole.scrollHeight;
    } catch (error) {
      notify(`日志读取失败：${String(error)}`, 'error');
    }
  }

  function openLogs() {
    section = 'logs';
    void refreshLogs(true);
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
      config = {
        ...config,
        scale: Math.min(3, Math.max(0.25, Number(config.scale) || 1)),
        speed: Math.min(5, Math.max(0.1, Number(config.speed) || 1)),
        monitor: Math.min(15, Math.max(0, Math.trunc(Number(config.monitor) || 0))),
      };
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

  async function fleetAction(action: 'start' | 'stop' | 'restart') {
    if (!selectedInstance) return;
    try {
      instances = await invoke<PetInstance[]>('instance_action', { id: selectedInstance.id, action });
      notify(`实例 ${selectedInstance.id} 已${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}`, 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  async function createPetInstance() {
    try {
      instances = await invoke<PetInstance[]>('create_instance', {
        id: newInstanceId.trim(),
        character: newInstanceCharacter,
        variant: newInstanceVariant,
      });
      selectedInstanceId = newInstanceId.trim();
      newInstanceId = '';
      notify('新桌宠实例已创建并启动', 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  function newInstanceCharacterChanged() {
    const character = characters.find((entry) => entry.id === newInstanceCharacter);
    if (character) newInstanceVariant = character.default_variant_id;
  }

  async function toggleInstanceAutostart() {
    if (!selectedInstance) return;
    try {
      instances = await invoke<PetInstance[]>('set_instance_autostart', {
        id: selectedInstance.id,
        enabled: !selectedInstance.autostart,
      });
      notify('实例自启策略已更新', 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  async function reactInstance(event: 'attention' | 'celebrate' | 'wake') {
    if (!selectedInstance?.active) return;
    try {
      await invoke('instance_react', { id: selectedInstance.id, event });
      notify(`已向 ${selectedInstance.id} 发送互动事件`, 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  async function toggleContextService() {
    try {
      contextService = await invoke<ServiceStatus>('context_action', { action: contextService.active ? 'stop' : 'start' });
      notify(contextService.active ? '桌面只读感知已启用' : '桌面只读感知已停止', 'ok');
    } catch (error) {
      notify(String(error), 'error');
    }
  }

  function characterChanged() {
    const character = characters.find((entry) => entry.id === config.character);
    if (character) config.variant = character.default_variant_id;
    void loadPreview();
  }

  function adjustParameter(parameter: 'scale' | 'speed', delta: number) {
    const limits = parameter === 'scale' ? [0.25, 3] : [0.1, 5];
    const current = Number(config[parameter]) || 1;
    config = {
      ...config,
      [parameter]: Math.min(limits[1], Math.max(limits[0], Math.round((current + delta) * 100) / 100)),
    };
  }

  onMount(() => {
    let cancelled = false;
    Promise.all([
      invoke<CharacterSummary[]>('list_characters'),
      invoke<RuntimeConfig>('load_config'),
      invoke<PetInstance[]>('list_instances'),
      invoke<ServiceStatus>('context_status'),
    ]).then(async ([registry, saved, runningInstances, context]) => {
      if (cancelled) return;
      config = saved;
      characters = registry;
      instances = runningInstances;
      contextService = context;
      await loadPreview();
      await refreshStatus();
      loading = false;
    }).catch((error) => {
      loading = false;
      notify(String(error), 'error');
    });
    const statusTimer = window.setInterval(() => refreshStatus(true), 1500);
    const fleetTimer = window.setInterval(() => refreshFleet(true), 3500);
    const logTimer = window.setInterval(refreshLogs, 1400);
    return () => {
      cancelled = true;
      clearInterval(statusTimer);
      clearInterval(fleetTimer);
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
      <button class:active={section === 'fleet'} onclick={() => { section = 'fleet'; void refreshFleet(false); }}><span>02</span>多桌宠编队</button>
      <button class:active={section === 'settings'} onclick={() => section = 'settings'}><span>03</span>桌宠设置</button>
      <button class:active={section === 'logs'} onclick={openLogs}><span>04</span>运行日志</button>
      <button class:active={section === 'system'} onclick={() => section = 'system'}><span>05</span>服务管理</button>
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
            <div class="action-row"><button class="ghost" onclick={() => section = 'system'}>前往服务管理 →</button></div>
          </article>
        </div>
      </section>
    {:else if section === 'fleet'}
      <section class="page enter">
        <div class="page-heading">
          <div><span class="eyebrow">FLEET / 02</span><h1>多桌宠编队</h1></div>
          <span class="save-state">{instances.filter((entry) => entry.active).length} / {instances.length} ACTIVE</span>
        </div>
        <div class="fleet-layout">
          <article class="fleet-roster">
            <div class="card-title"><span>实例阵列</span><small>SELECT ONE</small></div>
            <div class="instance-grid">
              {#each instances as instance}
                <button class:active={selectedInstance?.id === instance.id} class="instance-card" onclick={() => selectedInstanceId = instance.id}>
                  <span class:online={instance.active} class="instance-signal"></span>
                  <small>{instance.id === 'default' ? 'PRIMARY' : 'AUXILIARY'}</small>
                  <strong>{characters.find((entry) => entry.id === instance.character)?.localized_name ?? instance.character}</strong>
                  <code>{instance.id} / {instance.variant}</code>
                  <i>{instance.active ? `PID ${instance.pid}` : 'OFFLINE'}</i>
                </button>
              {/each}
            </div>
          </article>

          <article class="fleet-console">
            <div class="card-title"><span>选中实例控制</span><small>{selectedInstance?.id ?? 'NO TARGET'}</small></div>
            {#if selectedInstance}
              <div class="fleet-status-line"><span>运行状态</span><strong class:online-text={selectedInstance.active}>{selectedInstance.active ? 'LINK ACTIVE' : 'LINK OFFLINE'}</strong></div>
              <div class="service-buttons fleet-buttons">
                <button onclick={() => fleetAction('start')} disabled={selectedInstance.active}>启动</button>
                <button onclick={() => fleetAction('restart')} disabled={!selectedInstance.active}>重启</button>
                <button class="danger-soft" onclick={() => fleetAction('stop')} disabled={!selectedInstance.active}>停止</button>
              </div>
              <label class="switch-row"><span><b>随桌面会话自启</b><small>仅控制当前选中实例</small></span><input type="checkbox" checked={selectedInstance.autostart} onchange={toggleInstanceAutostart} /><i></i></label>
              <div class="reaction-panel">
                <span>即时互动测试</span>
                <div><button onclick={() => reactInstance('attention')} disabled={!selectedInstance.active}>打招呼</button><button onclick={() => reactInstance('celebrate')} disabled={!selectedInstance.active}>庆祝一下</button><button onclick={() => reactInstance('wake')} disabled={!selectedInstance.active}>轻声唤醒</button></div>
              </div>
            {/if}
          </article>

          <article class="fleet-create">
            <div class="card-title"><span>部署新实例</span><small>MAX 8</small></div>
            <div class="fleet-create-fields">
              <label><span>实例 ID</span><input placeholder="例如 mon3tr-side" bind:value={newInstanceId} /></label>
              <label><span>干员</span><select bind:value={newInstanceCharacter} onchange={newInstanceCharacterChanged}>{#each characters as character}<option value={character.id}>{character.localized_name}</option>{/each}</select></label>
              <label><span>外观</span><select bind:value={newInstanceVariant}>{#each newInstanceVariants as variant}<option value={variant.id}>{variant.localized_name}</option>{/each}</select></label>
              <button class="primary" onclick={createPetInstance} disabled={!newInstanceId.trim() || instances.length >= 8}>创建并启动</button>
            </div>
          </article>

          <article class="context-card">
            <div class="card-title"><span>桌面事件感知</span><small>READ ONLY / NIRI</small></div>
            <div class="capability-row">
              <div><b>焦点响应与社交时刻</b><p>读取 niri 结构化事件，让桌宠响应工作区、应用焦点并偶发相互问候；不截屏、不读窗口内容、不注入键鼠。</p></div>
              <button class:context-active={contextService.active} onclick={toggleContextService}>{contextService.active ? '停止感知' : '启用感知'}</button>
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
            <label class="range-field">
              <span>显示大小 <b>{Number(config.scale || 0).toFixed(2)}×</b></span>
              <div class="range-control">
                <input class="industrial-range" aria-label="显示大小滑块" type="range" min="0.25" max="3" step="0.05" bind:value={config.scale} style={`--range-progress:${((Number(config.scale) - 0.25) / 2.75) * 100}%`} />
                <div class="precision-stepper">
                  <button type="button" aria-label="减小显示大小" onclick={() => adjustParameter('scale', -0.01)}>−</button>
                  <input class="precision-input" aria-label="精确输入显示大小" type="number" min="0.25" max="3" step="0.01" bind:value={config.scale} />
                  <button type="button" aria-label="增大显示大小" onclick={() => adjustParameter('scale', 0.01)}>+</button>
                </div>
              </div>
            </label>
            <label class="range-field">
              <span>移动速度 <b>{Number(config.speed || 0).toFixed(2)}×</b></span>
              <div class="range-control">
                <input class="industrial-range" aria-label="移动速度滑块" type="range" min="0.1" max="5" step="0.05" bind:value={config.speed} style={`--range-progress:${((Number(config.speed) - 0.1) / 4.9) * 100}%`} />
                <div class="precision-stepper">
                  <button type="button" aria-label="减小移动速度" onclick={() => adjustParameter('speed', -0.01)}>−</button>
                  <input class="precision-input" aria-label="精确输入移动速度" type="number" min="0.1" max="5" step="0.01" bind:value={config.speed} />
                  <button type="button" aria-label="增大移动速度" onclick={() => adjustParameter('speed', 0.01)}>+</button>
                </div>
              </div>
            </label>
          </article>
          <article class="settings-card">
            <div class="card-title"><span>行为策略</span><small>RUNTIME</small></div>
            <label class="switch-row"><span><b>自动移动</b><small>空闲后在当前输出内巡游</small></span><input type="checkbox" bind:checked={config.auto_move} /><i></i></label>
            <label class="switch-row"><span><b>点击穿透</b><small>允许指针穿过桌宠可见区域</small></span><input type="checkbox" bind:checked={config.click_through} /><i></i></label>
          </article>
          <article class="settings-card wide compact">
            <label><span>显示器编号</span><input type="number" min="0" max="15" bind:value={config.monitor} /></label>
            <div class="settings-actions"><span>{settingsNeedRestart ? '显示器变更将自动重启桌宠' : '其余参数实时生效'}</span><button class="primary" onclick={() => save(settingsNeedRestart)} disabled={saving}>应用设置</button></div>
          </article>
        </div>
      </section>
    {:else if section === 'logs'}
      <section class="page logs-page enter">
        <div class="page-heading"><div><span class="eyebrow">DIAGNOSTICS / 03</span><h1>运行日志</h1></div><button class="ghost" onclick={() => refreshLogs(true)}>刷新并定位最新</button></div>
        <div class="log-toolbar"><select aria-label="日志实例" bind:value={selectedInstanceId} onchange={() => refreshLogs(true)}>{#each instances as instance}<option value={instance.id}>{instance.id} / {instance.character}</option>{/each}</select><input placeholder="筛选日志内容…" bind:value={logFilter} /><span>{visibleLogs.length} RECORDS</span></div>
        <div class="log-console" bind:this={logConsole}>
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
            <div class="card-title"><span>开机自启</span><small>{service.autostart ? 'ENABLED' : 'DISABLED'}</small></div>
            <label class="switch-row"><span><b>开机 / 登录后自启</b><small>开机进入 Wayland 桌面会话后自动启动桌宠</small></span><input type="checkbox" checked={service.autostart} onchange={toggleAutostart} /><i></i></label>
          </article>
          <article class="service-card path-card"><span>CONFIG</span><code>~/.config/pet-ark/runtime.env</code><span>CONTROL</span><code>$XDG_RUNTIME_DIR/pet-ark/control.sock</code></article>
        </div>
      </section>
    {/if}
  </main>

  <footer><span>PET ARK CONTROL CENTER</span><span>LOCAL AUTHORITY // NO NETWORK</span><span>BUILD 0.2.1</span></footer>
</div>
