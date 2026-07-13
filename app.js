(() => {
  'use strict';

  let CIDADES = [];
  let byNormName = new Map();
  let cityWatchId = null;
  let selectedCity = null;
  let activeTab = 'nome';
  let radiusResultsCache = [];

  const tabsBar = document.getElementById('tabsBar');
  const panelNome = document.getElementById('panelNome');
  const panelRaio = document.getElementById('panelRaio');
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearBtn');
  const suggestionsList = document.getElementById('suggestionsList');
  const emptyState = document.getElementById('emptyState');
  const globalStats = document.getElementById('globalStats');
  const cityCard = document.getElementById('cityCard');
  const detailSheet = document.getElementById('detailSheet');
  const sheetTitle = document.getElementById('sheetTitle');
  const sheetBody = document.getElementById('sheetBody');
  const sheetClose = document.getElementById('sheetClose');
  const toastEl = document.getElementById('toast');
  const radiusInput = document.getElementById('radiusInput');
  const radiusSearchBtn = document.getElementById('radiusSearchBtn');
  const radiusStatus = document.getElementById('radiusStatus');
  const radiusResultsList = document.getElementById('radiusResultsList');

  let activeIndex = -1;
  let currentSuggestions = [];
  let toastTimer = null;

  function normalize(s) {
    return (s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function formatInt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('pt-BR');
  }

  function formatPct(fraction, digits = 2) {
    if (fraction == null) return '—';
    return (fraction * 100).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + '%';
  }

  function formatCurrency(v) {
    if (v == null || v === '') return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function formatDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }

  function showToast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  async function loadData() {
    const res = await fetch('data/cidades.json');
    CIDADES = await res.json();
    for (const c of CIDADES) {
      byNormName.set(normalize(c.nome), c);
    }
    renderGlobalStats();
  }

  function renderGlobalStats() {
    const totalCidades = CIDADES.length;
    const comEmenda = CIDADES.filter(c => c.emendas.length > 0).length;
    const comIndicacao = CIDADES.filter(c => c.indicacoes.length > 0).length;
    globalStats.innerHTML = `
      <div class="stat-pill"><div class="stat-pill-value">${totalCidades}</div><div class="stat-pill-label">Municípios</div></div>
      <div class="stat-pill"><div class="stat-pill-value">${comEmenda}</div><div class="stat-pill-label">Com emenda</div></div>
      <div class="stat-pill"><div class="stat-pill-value">${comIndicacao}</div><div class="stat-pill-label">Com indicação</div></div>
    `;
  }

  function highlightMatch(name, query) {
    const normName = normalize(name);
    const normQuery = normalize(query);
    const idx = normName.indexOf(normQuery);
    if (idx === -1 || !normQuery) return escapeHtml(name);
    return escapeHtml(name.slice(0, idx)) + '<mark>' + escapeHtml(name.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(name.slice(idx + query.length));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function search(query) {
    const q = normalize(query);
    if (!q) return [];
    const starts = [];
    const contains = [];
    for (const c of CIDADES) {
      const n = normalize(c.nome);
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q)) contains.push(c);
    }
    starts.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    contains.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return [...starts, ...contains].slice(0, 8);
  }

  function renderSuggestions(query) {
    const results = search(query);
    currentSuggestions = results;
    activeIndex = -1;

    if (!query.trim()) {
      suggestionsList.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      return;
    }

    if (results.length === 0) {
      suggestionsList.innerHTML = `<li class="suggestion-empty">Nenhum município encontrado</li>`;
      suggestionsList.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');
      return;
    }

    suggestionsList.innerHTML = results.map((c, i) => `
      <li class="suggestion-item" role="option" data-index="${i}">
        <span class="suggestion-name">${highlightMatch(c.nome, query)}</span>
        <span class="suggestion-meta">${formatInt(c.votos)} votos</span>
      </li>
    `).join('');
    suggestionsList.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
  }

  function selectCity(city) {
    selectedCity = city;
    stopCityGps();
    panelNome.hidden = true;
    panelRaio.hidden = true;
    renderCityCard(city);
    cityCard.hidden = false;

    if (activeTab === 'nome') {
      searchInput.value = city.nome;
      suggestionsList.hidden = true;
      clearBtn.hidden = false;
    }
  }

  function closeCityCard() {
    cityCard.hidden = true;
    selectedCity = null;
    stopCityGps();
    showPanel(activeTab);
    if (activeTab === 'nome') {
      searchInput.value = '';
      clearBtn.hidden = true;
      suggestionsList.hidden = true;
      emptyState.hidden = false;
    }
  }

  function renderCityCard(c) {
    emptyState.hidden = true;
    cityCard.hidden = false;

    const temEmenda = c.emendas.length > 0;
    const temIndicacao = c.indicacoes.length > 0;

    cityCard.innerHTML = `
      <div class="city-header">
        <button id="cityBackBtn" class="back-btn" type="button">&larr; Voltar</button>
        <h1 class="city-name">${escapeHtml(c.nome)}</h1>
        <div class="city-rank">${c.colocacao ? `#${formatInt(c.colocacao)} colocação estadual` : ''} · ${formatInt(c.populacao)} habitantes</div>
      </div>

      <div class="city-stats-grid">
        <div class="city-stat">
          <div class="city-stat-label">Votos Paulo Mansur</div>
          <div class="city-stat-value highlight">${formatInt(c.votos)}</div>
        </div>
        <div class="city-stat">
          <div class="city-stat-label">% de votos válidos</div>
          <div class="city-stat-value highlight">${formatPct(c.pctVotos)}</div>
        </div>
        <div class="city-stat">
          <div class="city-stat-label">Eleitores (2024)</div>
          <div class="city-stat-value">${formatInt(c.eleitores)}</div>
        </div>
        <div class="city-stat">
          <div class="city-stat-label">População</div>
          <div class="city-stat-value">${formatInt(c.populacao)}</div>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="status-row">
        <div class="status-label-wrap">
          <span class="status-label">Emenda parlamentar</span>
          ${temEmenda ? `<span class="status-count">${c.emendas.length} ${c.emendas.length === 1 ? 'registro' : 'registros'}</span>` : ''}
        </div>
        <div class="status-right">
          <span class="badge ${temEmenda ? 'badge-yes' : 'badge-no'}">${temEmenda ? 'Sim' : 'Não'}</span>
          <button class="ver-mais-btn" data-type="emendas" ${temEmenda ? '' : 'disabled aria-disabled="true"'}>Ver mais</button>
        </div>
      </div>

      <div class="status-row">
        <div class="status-label-wrap">
          <span class="status-label">Indicação / demanda</span>
          ${temIndicacao ? `<span class="status-count">${c.indicacoes.length} ${c.indicacoes.length === 1 ? 'registro' : 'registros'}</span>` : ''}
        </div>
        <div class="status-right">
          <span class="badge ${temIndicacao ? 'badge-yes' : 'badge-no'}">${temIndicacao ? 'Sim' : 'Não'}</span>
          <button class="ver-mais-btn" data-type="indicacoes" ${temIndicacao ? '' : 'disabled aria-disabled="true"'}>Ver mais</button>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="gps-section">
        <button id="gpsBtn" class="gps-btn" type="button">📍 Calcular distância até ${escapeHtml(c.nome)}</button>
        <div id="gpsResult"></div>
      </div>
    `;

    cityCard.querySelectorAll('.ver-mais-btn').forEach(btn => {
      btn.addEventListener('click', () => openDetailSheet(btn.dataset.type));
    });

    document.getElementById('gpsBtn').addEventListener('click', toggleGps);
    document.getElementById('cityBackBtn').addEventListener('click', closeCityCard);
  }

  function openDetailSheet(type) {
    const c = selectedCity;
    if (!c) return;
    const items = type === 'emendas' ? c.emendas : c.indicacoes;
    sheetTitle.textContent = (type === 'emendas' ? 'Emendas' : 'Indicações / Demandas') + ' — ' + c.nome;
    sheetBody.innerHTML = items.map(item => renderDetailItem(item, type)).join('');
    detailSheet.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeDetailSheet() {
    detailSheet.hidden = true;
    document.body.style.overflow = '';
  }

  function renderDetailItem(item, type) {
    if (type === 'emendas') {
      const isCancelada = item.cancelada && normalize(item.cancelada) === 'sim';
      return `
        <div class="detail-item">
          <div class="detail-item-head">
            <div class="detail-item-title">${escapeHtml(item.objeto || item.segmento || 'Emenda')}</div>
            <div class="detail-item-value">${formatCurrency(item.valor)}</div>
          </div>
          <div class="detail-tags">
            ${item.segmento ? `<span class="tag">${escapeHtml(item.segmento)}</span>` : ''}
            ${item.tipo ? `<span class="tag">${escapeHtml(item.tipo)}</span>` : ''}
            ${item.ano ? `<span class="tag">${escapeHtml(item.ano)}</span>` : ''}
            ${item.status ? `<span class="tag tag-status">${escapeHtml(item.status)}</span>` : ''}
            ${isCancelada ? `<span class="tag tag-cancelada">Cancelada</span>` : ''}
          </div>
          ${item.beneficiario ? `<div class="detail-field"><b>Beneficiário:</b> ${escapeHtml(item.beneficiario)}</div>` : ''}
          ${item.numeroIndicacao ? `<div class="detail-field"><b>Nº da indicação:</b> ${escapeHtml(item.numeroIndicacao)}</div>` : ''}
          ${item.lote ? `<div class="detail-field"><b>Lote/Origem:</b> ${escapeHtml(item.lote)}</div>` : ''}
          ${item.validacao ? `<div class="detail-field"><b>Validação:</b> ${escapeHtml(item.validacao)}</div>` : ''}
          ${item.observacoes ? `<div class="detail-obs">${escapeHtml(item.observacoes)}</div>` : ''}
        </div>
      `;
    }
    return `
      <div class="detail-item">
        <div class="detail-item-head">
          <div class="detail-item-title">${escapeHtml(item.objeto || item.categoria || 'Demanda')}</div>
          ${item.valorEstimado ? `<div class="detail-item-value">${formatCurrency(item.valorEstimado)}</div>` : ''}
        </div>
        <div class="detail-tags">
          ${item.segmento ? `<span class="tag">${escapeHtml(item.segmento)}</span>` : ''}
          ${item.categoria ? `<span class="tag">${escapeHtml(item.categoria)}</span>` : ''}
          ${item.status ? `<span class="tag tag-status">${escapeHtml(item.status)}</span>` : ''}
        </div>
        ${item.escola ? `<div class="detail-field"><b>Escola:</b> ${escapeHtml(item.escola)}</div>` : ''}
        ${item.prefeito ? `<div class="detail-field"><b>Prefeito:</b> ${escapeHtml(item.prefeito)}</div>` : ''}
        ${item.vereador ? `<div class="detail-field"><b>Vereador:</b> ${escapeHtml(item.vereador)}</div>` : ''}
        ${item.validacao ? `<div class="detail-field"><b>Validação:</b> ${escapeHtml(item.validacao)}</div>` : ''}
        ${item.observacoes ? `<div class="detail-obs">${escapeHtml(item.observacoes)}</div>` : ''}
      </div>
    `;
  }

  // --- GPS / distance ---

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function geoErrorMessage(err) {
    if (err.code === err.PERMISSION_DENIED) {
      return 'Permissão de localização negada. Habilite o GPS/localização para este site nas configurações do navegador.';
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      return 'Localização indisponível no momento. Verifique se o GPS está ativado.';
    } else if (err.code === err.TIMEOUT) {
      return 'Tempo esgotado ao tentar obter sua localização. Tente novamente.';
    }
    return 'Não foi possível obter sua localização.';
  }

  function toggleGps() {
    if (cityWatchId !== null) {
      stopCityGps();
      return;
    }
    startCityGps();
  }

  function startCityGps() {
    const c = selectedCity;
    if (!c || c.lat == null || c.lon == null) {
      renderGpsError('Coordenadas do município não disponíveis.');
      return;
    }
    if (!('geolocation' in navigator)) {
      renderGpsError('Este dispositivo/navegador não suporta geolocalização.');
      return;
    }

    const gpsBtn = document.getElementById('gpsBtn');
    if (gpsBtn) {
      gpsBtn.classList.add('active');
      gpsBtn.textContent = '⏹ Parar cálculo de distância';
    }

    cityWatchId = navigator.geolocation.watchPosition(
      pos => renderGpsResult(pos, c),
      err => {
        renderGpsError(geoErrorMessage(err));
        stopCityGps();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function stopCityGps() {
    if (cityWatchId !== null) {
      navigator.geolocation.clearWatch(cityWatchId);
      cityWatchId = null;
    }
    const gpsBtn = document.getElementById('gpsBtn');
    if (gpsBtn) {
      gpsBtn.classList.remove('active');
      gpsBtn.textContent = `📍 Calcular distância até ${escapeHtml(selectedCity ? selectedCity.nome : 'município')}`;
    }
  }

  function renderGpsResult(pos, city) {
    const { latitude, longitude, accuracy } = pos.coords;
    const distKm = haversineKm(latitude, longitude, city.lat, city.lon);
    const resultEl = document.getElementById('gpsResult');
    if (!resultEl) return;

    resultEl.innerHTML = `
      <div class="gps-result">
        <span class="gps-pulse"></span><span class="gps-distance">${formatDistance(distKm)}</span>
        <div class="gps-sub">Distância em linha reta até ${escapeHtml(city.nome)} · precisão do GPS: ±${Math.round(accuracy)}m</div>
      </div>
    `;
  }

  function renderGpsError(msg) {
    const resultEl = document.getElementById('gpsResult');
    if (resultEl) resultEl.innerHTML = `<div class="gps-error">${escapeHtml(msg)}</div>`;
  }

  // --- Radius search ---

  function showPanel(tab) {
    activeTab = tab;
    [...tabsBar.children].forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    panelNome.hidden = tab !== 'nome';
    panelRaio.hidden = tab !== 'raio';
  }

  function switchTab(tab) {
    if (tab === activeTab && cityCard.hidden) return;
    stopCityGps();
    cityCard.hidden = true;
    selectedCity = null;
    showPanel(tab);
  }

  function clampRadiusKm(v) {
    const n = Math.round(parseFloat(v));
    if (!Number.isFinite(n)) return null;
    return Math.min(150, Math.max(1, n));
  }

  function showRadiusStatus(msg, kind) {
    radiusStatus.className = 'radius-status' + (kind ? ` radius-status-${kind}` : '');
    radiusStatus.textContent = msg;
    radiusStatus.hidden = !msg;
  }

  function runRadiusSearch(km) {
    if (!('geolocation' in navigator)) {
      showRadiusStatus('Este dispositivo/navegador não suporta geolocalização.', 'error');
      return;
    }
    radiusResultsList.innerHTML = '';
    showRadiusStatus('Obtendo sua localização...', 'loading');

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        const results = CIDADES
          .filter(c => c.lat != null && c.lon != null)
          .map(c => ({ city: c, dist: haversineKm(latitude, longitude, c.lat, c.lon) }))
          .filter(r => r.dist <= km)
          .sort((a, b) => a.dist - b.dist);
        radiusResultsCache = results;
        renderRadiusResults(results, km);
      },
      err => showRadiusStatus(geoErrorMessage(err), 'error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function renderRadiusResults(results, km) {
    if (results.length === 0) {
      showRadiusStatus(`Nenhum município encontrado em um raio de ${km} km.`, 'empty');
      radiusResultsList.innerHTML = '';
      return;
    }
    showRadiusStatus(`${results.length} ${results.length === 1 ? 'município encontrado' : 'municípios encontrados'} em até ${km} km`, 'success');
    radiusResultsList.innerHTML = results.map(({ city, dist }, i) => `
      <li class="radius-item" data-index="${i}">
        <div class="radius-item-top">
          <span class="radius-item-name">${escapeHtml(city.nome)}</span>
          <span class="radius-item-dist">${formatDistance(dist)}</span>
        </div>
        <div class="radius-item-stats">
          <span>${formatInt(city.votos)} votos</span>
          <span>${formatPct(city.pctVotos)}</span>
        </div>
        <div class="radius-item-badges">
          <span class="badge-mini ${city.emendas.length ? 'badge-mini-yes' : 'badge-mini-no'}">Emenda: ${city.emendas.length ? 'Sim' : 'Não'}</span>
          <span class="badge-mini ${city.indicacoes.length ? 'badge-mini-yes' : 'badge-mini-no'}">Indicação: ${city.indicacoes.length ? 'Sim' : 'Não'}</span>
        </div>
      </li>
    `).join('');
  }

  // --- Event wiring ---

  searchInput.addEventListener('input', () => {
    const v = searchInput.value;
    clearBtn.hidden = v.length === 0;
    renderSuggestions(v);
    if (!v.trim()) {
      selectedCity = null;
      stopCityGps();
      cityCard.hidden = true;
      emptyState.hidden = false;
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (suggestionsList.hidden || currentSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, currentSuggestions.length - 1);
      updateActiveSuggestion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveSuggestion();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = activeIndex >= 0 ? currentSuggestions[activeIndex] : currentSuggestions[0];
      if (target) selectCity(target);
    } else if (e.key === 'Escape') {
      suggestionsList.hidden = true;
    }
  });

  function updateActiveSuggestion() {
    [...suggestionsList.children].forEach((li, i) => {
      li.classList.toggle('active', i === activeIndex);
    });
  }

  suggestionsList.addEventListener('click', (e) => {
    const li = e.target.closest('.suggestion-item');
    if (!li) return;
    const idx = Number(li.dataset.index);
    const city = currentSuggestions[idx];
    if (city) selectCity(city);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.hidden = true;
    suggestionsList.hidden = true;
    selectedCity = null;
    stopCityGps();
    cityCard.hidden = true;
    emptyState.hidden = false;
    searchInput.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-section')) {
      suggestionsList.hidden = true;
    }
  });

  sheetClose.addEventListener('click', closeDetailSheet);
  detailSheet.addEventListener('click', (e) => {
    if (e.target === detailSheet) closeDetailSheet();
  });

  tabsBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchTab(btn.dataset.tab);
  });

  radiusSearchBtn.addEventListener('click', () => {
    const km = clampRadiusKm(radiusInput.value);
    if (km == null) {
      showRadiusStatus('Digite uma distância válida (1 a 150 km).', 'error');
      return;
    }
    radiusInput.value = km;
    runRadiusSearch(km);
  });

  radiusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') radiusSearchBtn.click();
  });

  document.querySelector('.radius-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    radiusInput.value = chip.dataset.km;
    runRadiusSearch(Number(chip.dataset.km));
  });

  radiusResultsList.addEventListener('click', (e) => {
    const item = e.target.closest('.radius-item');
    if (!item) return;
    const idx = Number(item.dataset.index);
    const entry = radiusResultsCache[idx];
    if (entry) selectCity(entry.city);
  });

  // --- Init ---
  loadData().catch(err => {
    console.error(err);
    showToast('Erro ao carregar dados. Recarregue a página.');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
