const socket = io();

let allParticipants = [];
let filteredParticipants = [];
let fiscalName = "";
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;
let searchQuery = "";
let pendingCheckin = null;
let currentConfig = {}; // { col1_name, col2_name, has_qr, qr_col_name, filename, total }

// --- XSS protection ---
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// helpers
function toast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.innerText = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), duration);
}

function updateStats() {
  const total = allParticipants.length;
  const checkedIn = allParticipants.filter(p => p._checked_in).length;
  const pending = total - checkedIn;

  const totalEl = document.getElementById('total-participants');
  const checkedEl = document.getElementById('checked-in-count');
  const pendingEl = document.getElementById('pending-count');

  if (totalEl) totalEl.textContent = total;
  if (checkedEl) checkedEl.textContent = checkedIn;
  if (pendingEl) pendingEl.textContent = pending;
}

function updateTableHeaders() {
  const th1 = document.getElementById('th-col1');
  const th2 = document.getElementById('th-col2');
  if (th1) th1.textContent = currentConfig.col1_name || 'Coluna 1';
  if (th2) th2.textContent = currentConfig.col2_name || 'Coluna 2';
}

function updateConfigDisplay() {
  const el = document.getElementById('current-config');
  if (!el) return;

  if (currentConfig.filename) {
    let qrInfo = currentConfig.has_qr ? ` | QR: ${esc(currentConfig.qr_col_name)}` : '';
    el.innerHTML = `
      <p><strong>Arquivo:</strong> ${esc(currentConfig.filename)}</p>
      <p><strong>Colunas:</strong> ${esc(currentConfig.col1_name)} / ${esc(currentConfig.col2_name)}${qrInfo}</p>
      <p><strong>Total:</strong> ${currentConfig.total || 0} participantes</p>
      <p><strong>Enviado em:</strong> ${currentConfig.uploaded_at ? new Date(currentConfig.uploaded_at).toLocaleString('pt-BR') : '—'}</p>
    `;
    el.style.display = 'block';
  } else {
    el.innerHTML = '<p>Nenhuma planilha carregada ainda.</p>';
    el.style.display = 'block';
  }
}

function updateScannerVisibility() {
  const scannerSection = document.getElementById('scanner-section');
  if (!scannerSection) return;

  if (currentConfig.has_qr) {
    scannerSection.style.display = '';
  } else {
    scannerSection.style.display = 'none';
    // Parar scanner se estiver rodando
    stopScanner();
  }
}

function updateQrFieldVisibility() {
  const cb = document.getElementById('has-qr-check');
  const group = document.getElementById('qr-col-group');
  if (cb && group) {
    group.style.display = cb.checked ? '' : 'none';
  }
}

// --- Upload XLSX ---
async function uploadXLSX() {
  const fileInput = document.getElementById('xlsx-file');
  const col1 = document.getElementById('col1-input').value.trim();
  const col2 = document.getElementById('col2-input').value.trim();
  const statusEl = document.getElementById('upload-status');

  if (!col1 || !col2) {
    statusEl.innerHTML = '<span class="upload-error">Informe o nome das duas colunas.</span>';
    return;
  }
  if (!fileInput.files.length) {
    statusEl.innerHTML = '<span class="upload-error">Selecione um arquivo XLSX.</span>';
    return;
  }

  // Confirmar se já existe planilha carregada
  if (currentConfig.filename) {
    if (!confirm(`Já existe uma planilha carregada (${currentConfig.filename} com ${currentConfig.total} participantes).\n\nEnviar uma nova planilha vai substituir a lista atual. Deseja continuar?`)) {
      return;
    }
  }

  const hasQr = document.getElementById('has-qr-check')?.checked || false;
  const qrCol = document.getElementById('qr-col-input')?.value.trim() || '';

  if (hasQr && !qrCol) {
    statusEl.innerHTML = '<span class="upload-error">Informe o nome da coluna do QR Code.</span>';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('col1_name', col1);
  formData.append('col2_name', col2);
  formData.append('has_qr', hasQr);
  formData.append('qr_col_name', qrCol);

  statusEl.innerHTML = '<span class="upload-loading">Processando...</span>';

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      currentConfig = data.config || {};
      statusEl.innerHTML = `<span class="upload-success">✅ ${data.total} participantes carregados!</span>`;
      updateTableHeaders();
      updateConfigDisplay();
      updateScannerVisibility();
      fetchParticipants();
      toast(`Planilha carregada: ${data.total} participantes`, 3000);
      // Iniciar scanner se QR habilitado
      if (currentConfig.has_qr) startScanner().catch(() => { });
    } else {
      statusEl.innerHTML = `<span class="upload-error">❌ ${data.error}</span>`;
    }
  } catch (err) {
    statusEl.innerHTML = `<span class="upload-error">Erro de conexão: ${err.message}</span>`;
  }
}

// --- Fetch participantes ---
async function fetchParticipants() {
  try {
    const res = await fetch("/api/participants");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    allParticipants = data.participants || [];
    filteredParticipants = allParticipants;

    if (data.config) {
      currentConfig = data.config;
      updateTableHeaders();
      updateConfigDisplay();
      updateScannerVisibility();
    }

    // re-aplicar filtro se existir
    if (searchQuery) {
      applySearch(searchQuery);
    } else {
      currentPage = 1;
      updateStats();
      updatePaginationAndRender();
    }
  } catch (err) {
    console.error('Erro ao buscar participantes:', err);
    toast('Erro ao carregar participantes: ' + err.message, 4000);
  }
}

function applySearch(q) {
  searchQuery = q;
  if (q) {
    filteredParticipants = allParticipants.filter(p =>
      (p.col1 || "").toLowerCase().includes(q) ||
      (p.col2 || "").toLowerCase().includes(q) ||
      (p.qr_code || "").toLowerCase().includes(q)
    );
  } else {
    filteredParticipants = allParticipants;
  }
  currentPage = 1;
  updatePaginationAndRender();
}

function updatePaginationAndRender() {
  const totalItems = filteredParticipants.length;
  totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  updatePaginationControls(totalItems);
  renderTable();
}

function updatePaginationControls(totalItems) {
  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  const pageInfo = document.getElementById('page-info');

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  if (pageInfo) pageInfo.innerText = `Página ${currentPage} de ${totalPages} (${totalItems} total)`;
}

function goToPage(page) {
  currentPage = page;
  updatePaginationAndRender();
}

function renderTable() {
  const tbody = document.querySelector("#participants-table tbody");
  tbody.innerHTML = "";

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageItems = filteredParticipants.slice(startIdx, endIdx);

  for (const p of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(p.col1)}</td>
      <td>${esc(p.col2)}</td>
      <td>${p._checked_in ? `✅ ${esc(p._checked_by)}` : "—"}</td>
      <td>
        ${p._checked_in
        ? `<button class="unmark" data-id="${esc(p.external_id)}">Desfazer</button>`
        : `<button class="mark" data-id="${esc(p.external_id)}">Check-in</button>`
      }
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (pageItems.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="text-align:center;color:var(--text-secondary);padding:24px;">Nenhum participante encontrado. Envie uma planilha nas configurações.</td>`;
    tbody.appendChild(tr);
  }
}

// --- Checkin ---
async function markCheckin(external_id, skipConfirmation = false) {
  if (!skipConfirmation) {
    showConfirmation(external_id);
    return;
  }

  const fiscal = document.getElementById('fiscal-name').value || "Fiscal";
  try {
    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_id, fiscal })
    });
    const body = await res.json();
    if (res.ok) {
      toast("Check-in marcado!", 2000);
      updateParticipantCheckin(external_id, true, fiscal, body.payload.checked_at);
    } else {
      toast("Erro ao marcar: " + (body.error || res.status), 3000);
    }
  } catch (err) {
    toast("Erro de conexão ao marcar check-in", 3000);
  }
}

function showConfirmation(external_id) {
  const participant = findParticipant(external_id);
  const modal = document.getElementById('confirm-modal');
  const infoDiv = document.getElementById('confirm-participant-info');
  const col1Label = currentConfig.col1_name || 'Coluna 1';
  const col2Label = currentConfig.col2_name || 'Coluna 2';

  if (!participant) {
    infoDiv.innerHTML = `
      <p><strong>⚠️ Participante não encontrado</strong></p>
      <p>ID: <code>${esc(external_id)}</code></p>
      <p>Este ID não foi encontrado na lista de participantes.</p>
    `;
  } else if (participant._checked_in) {
    infoDiv.innerHTML = `
      <p><strong>⚠️ Check-in já realizado</strong></p>
      <p><strong>${esc(col1Label)}:</strong> ${esc(participant.col1)}</p>
      <p><strong>${esc(col2Label)}:</strong> ${esc(participant.col2)}</p>
      <p><strong>Check-in feito por:</strong> ${esc(participant._checked_by)}</p>
    `;
  } else {
    infoDiv.innerHTML = `
      <p><strong>${esc(col1Label)}:</strong> ${esc(participant.col1)}</p>
      <p><strong>${esc(col2Label)}:</strong> ${esc(participant.col2)}</p>
    `;
  }

  pendingCheckin = external_id;
  modal.classList.remove('hidden');
}

function hideConfirmation() {
  const modal = document.getElementById('confirm-modal');
  modal.classList.add('hidden');
  pendingCheckin = null;
}

function findParticipant(external_id) {
  return allParticipants.find(p => p.external_id === external_id);
}

function updateParticipantCheckin(external_id, checked, fiscal, checked_at) {
  const idx1 = allParticipants.findIndex(p => p.external_id === external_id);
  if (idx1 >= 0) {
    allParticipants[idx1]._checked_in = checked;
    allParticipants[idx1]._checked_by = fiscal;
    allParticipants[idx1]._checked_at = checked_at;
  }
  const idx2 = filteredParticipants.findIndex(p => p.external_id === external_id);
  if (idx2 >= 0) {
    filteredParticipants[idx2]._checked_in = checked;
    filteredParticipants[idx2]._checked_by = fiscal;
    filteredParticipants[idx2]._checked_at = checked_at;
  }
  updateStats();
  renderTable();
}

async function uncheck(external_id) {
  try {
    const res = await fetch("/api/uncheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ external_id })
    });
    const body = await res.json();
    if (res.ok) {
      toast("Check-in desfeito", 2000);
      updateParticipantCheckin(external_id, false, null, null);
    } else {
      toast("Erro: " + (body.error || res.status), 3000);
    }
  } catch (err) {
    toast("Erro de conexão ao desfazer check-in", 3000);
  }
}

// --- Reset ---
async function resetCheckins() {
  if (!confirm("Tem certeza que deseja resetar TODOS os check-ins? Esta ação não pode ser desfeita.")) return;

  try {
    const res = await fetch("/api/reset", { method: "POST" });
    if (res.ok) {
      toast("Todos os check-ins foram resetados!", 3000);
      fetchParticipants();
    } else {
      toast("Erro ao resetar", 3000);
    }
  } catch (err) {
    toast("Erro de conexão ao resetar", 3000);
  }
}

// --- Exportar ---
function exportCSV() {
  window.open('/api/checkins/export?format=csv', '_blank');
}

function exportJSON() {
  window.open('/api/checkins/export?format=json', '_blank');
}

// --- Settings toggle ---
function toggleSettings() {
  const body = document.getElementById('settings-body');
  const icon = document.getElementById('toggle-icon');
  if (body.classList.contains('collapsed')) {
    body.classList.remove('collapsed');
    icon.textContent = '▼';
  } else {
    body.classList.add('collapsed');
    icon.textContent = '▶';
  }
}

// --- Event listeners ---
document.addEventListener('click', (ev) => {
  if (ev.target.matches('.mark')) {
    markCheckin(ev.target.dataset.id, true);
  } else if (ev.target.matches('.unmark')) {
    uncheck(ev.target.dataset.id);
  } else if (ev.target.id === 'btn-refresh') {
    fetchParticipants();
  } else if (ev.target.id === 'btn-mark-manual') {
    const id = document.getElementById('external-id-input').value.trim();
    if (id) {
      // Se QR habilitado, buscar pelo campo qr_code primeiro
      if (currentConfig.has_qr) {
        const participant = allParticipants.find(p => p.qr_code === id);
        if (participant) {
          markCheckin(participant.external_id);
        } else {
          markCheckin(id); // fallback
        }
      } else {
        markCheckin(id);
      }
    }
  } else if (ev.target.id === 'btn-prev') {
    if (currentPage > 1) goToPage(currentPage - 1);
  } else if (ev.target.id === 'btn-next') {
    if (currentPage < totalPages) goToPage(currentPage + 1);
  } else if (ev.target.id === 'btn-confirm-yes') {
    if (pendingCheckin) {
      const idToCheck = pendingCheckin;
      hideConfirmation();
      markCheckin(idToCheck, true);
    }
  } else if (ev.target.id === 'btn-confirm-no') {
    hideConfirmation();
    toast('Check-in cancelado', 1500);
  } else if (ev.target.id === 'btn-upload') {
    uploadXLSX();
  } else if (ev.target.id === 'btn-reset-checkins') {
    resetCheckins();
  } else if (ev.target.id === 'btn-export-csv') {
    exportCSV();
  } else if (ev.target.id === 'btn-export-json') {
    exportJSON();
  } else if (ev.target.id === 'settings-toggle' || ev.target.closest('#settings-toggle')) {
    toggleSettings();
  }
});

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search');
  const pageSizeSelect = document.getElementById('page-size-select');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      applySearch(e.target.value.trim().toLowerCase());
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', (e) => {
      pageSize = parseInt(e.target.value);
      currentPage = 1;
      updatePaginationAndRender();
    });
  }

  // Carregar nome do fiscal do localStorage
  const fiscalInput = document.getElementById('fiscal-name');
  if (fiscalInput) {
    const savedFiscal = localStorage.getItem('checkin_fiscal_name');
    if (savedFiscal) fiscalInput.value = savedFiscal;
    fiscalInput.addEventListener('input', () => {
      localStorage.setItem('checkin_fiscal_name', fiscalInput.value);
    });
  }

  // QR checkbox toggle
  const qrCheck = document.getElementById('has-qr-check');
  if (qrCheck) {
    qrCheck.addEventListener('change', () => updateQrFieldVisibility());
    updateQrFieldVisibility(); // estado inicial
  }

  // Carregar participantes
  fetchParticipants();

  // Iniciar scanner somente se QR habilitado (será chamado após fetchParticipants via updateScannerVisibility)

  // Colapsar configurações por padrão se já tem planilha carregada
  setTimeout(() => {
    if (currentConfig.filename) {
      const body = document.getElementById('settings-body');
      const icon = document.getElementById('toggle-icon');
      if (body && !body.classList.contains('collapsed')) {
        body.classList.add('collapsed');
        icon.textContent = '▶';
      }
    }
  }, 1000);
});

// --- SocketIO ---
socket.on("checkin_update", (payload) => {
  updateParticipantCheckin(
    payload.external_id,
    payload.checked_in,
    payload.checked_by || null,
    payload.checked_at || null
  );
});

socket.on("initial_state", (data) => {
  console.log("estado inicial", data);
});

socket.on("participants_updated", () => {
  fetchParticipants();
});

// --- QR Scanner ---
let scanning = false;
let scanInterval = null;

function stopScanner() {
  const video = document.getElementById('video');
  try {
    const stream = video?.srcObject;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    if (video) video.srcObject = null;
  } catch (e) { }
  scanning = false;
  if (scanInterval) {
    cancelAnimationFrame(scanInterval);
    scanInterval = null;
  }
}

async function startScanner() {
  const video = document.getElementById('video');
  if (!video) return;
  if (!currentConfig.has_qr) return; // não iniciar se QR não habilitado
  if (scanning) return; // já rodando

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.setAttribute('playsinline', true);
    await video.play();
    scanning = true;
    scanInterval = requestAnimationFrame(tick);
  } catch (err) {
    console.error("Erro câmera", err);
    toast("Impossível acessar câmera. Cole o ID manualmente.", 4000);
  }
}

function tick() {
  const video = document.getElementById('video');
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    scanInterval = requestAnimationFrame(tick);
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if (code) {
    const txt = code.data.trim();
    const resultEl = document.getElementById('scan-result');
    if (resultEl) resultEl.innerText = "QR lido: " + txt;
    // Buscar participante pelo campo qr_code
    const participant = allParticipants.find(p => p.qr_code === txt);
    if (participant) {
      markCheckin(participant.external_id);
    } else {
      // Tentar pelo external_id como fallback
      markCheckin(txt);
    }
    setTimeout(() => {
      const resultEl = document.getElementById('scan-result');
      if (resultEl) resultEl.innerText = "";
    }, 1800);
  }
  scanInterval = requestAnimationFrame(tick);
}

window.addEventListener('beforeunload', () => {
  const video = document.getElementById('video');
  try {
    const stream = video?.srcObject;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
  } catch (e) { }
});
