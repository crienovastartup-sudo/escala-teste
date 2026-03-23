/**
 * Configurações Globais e Variáveis de Estado
 * Mantém todas as tuas chaves de API e configurações de turnos
 */
const API_URL = "https://script.google.com/macros/s/AKfycbz5n2N8iYhzWGH6Pz7T8aFPgMQ98s9HXLq-wmD-m7mv4vcpOqbUsztCsenJ6k6XVlNnJg/exec";
const CLOUD_NAME = "dwlrxb6a0";
const UPLOAD_PRESET = "ml_default";

const CONFIG_TURNOS = {
    "PRIMEIRO": { inicio: "07:00", fim: "12:00" },
    "SEGUNDO":  { inicio: "12:00", fim: "17:00" },
    "TERCEIRO": { inicio: "17:00", fim: "21:00" },
    "MANHÃ":    { inicio: "07:00", fim: "13:00" },
    "TARDE":    { inicio: "13:00", fim: "19:00" }
};

let oficiantes = []; 
let escala = [];      
let calendar;        
let currentUser = null; 

/**
 * Funções Utilitárias de Data
 */
function formatarDataLimpa(dataStr) {
    if (!dataStr) return { dataFormatada: "Data Inválida", diaSemana: "N/A", parts: [] };
    
    const apenasData = dataStr.includes('T') ? dataStr.split('T')[0] : dataStr;
    const parts = apenasData.split('-'); 
    
    if (parts.length !== 3) return { dataFormatada: apenasData, diaSemana: "N/A", parts };

    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0);
    const diasSemana = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
    
    return {
        dataFormatada: `${parts[2]}/${parts[1]}/${parts[0]}`,
        diaSemana: diasSemana[d.getDay()],
        parts: parts
    };
}

/**
 * Inicialização do Sistema
 */
window.onload = () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();
    initCalendar();
    fetchData();
    setupEventListeners();
};

function setupEventListeners() {
    const setorSelect = document.getElementById('escala-setor');
    if (setorSelect) {
        setorSelect.addEventListener('change', (e) => {
            const val = e.target.value.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isRecepcao = val === 'RECEPCAO';
            const hourFields = document.getElementById('escala-horas-container');
            if (hourFields) {
                hourFields.classList.toggle('hidden', !isRecepcao);
            }
        });
    }

    // Eventos de Filtro
    ['filter-setor', 'filter-turno', 'filter-oficiante'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilters);
    });
}

/**
 * Chamada Genérica para a API com Retry e Exponential Backoff
 */
async function apiCall(data) {
    showLoading(true);
    let retries = 5;
    let delay = 1000;

    while (retries > 0) {
        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify(data)
            });
            const json = await res.json();
            showLoading(false);
            return json;
        } catch (e) {
            retries--;
            if (retries === 0) {
                showLoading(false);
                return { status: "error", message: "Falha na comunicação com o servidor após várias tentativas." };
            }
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

/**
 * Upload Cloudinary
 */
async function uploadParaCloudinary(file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", UPLOAD_PRESET);
    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        return data.secure_url || ""; 
    } catch (error) {
        console.error("Falha no upload Cloudinary:", error);
        throw error;
    }
}

/**
 * FullCalendar - Configuração e Renderização
 */
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
        locale: 'pt-br',
        height: 'auto',
        timeZone: 'UTC',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listWeek'
        },
        eventContent: function(arg) {
            const ext = arg.event.extendedProps;
            const setor = (ext.setor || "").toUpperCase();
            let colorClass = "card-default";
            if (setor.includes("BATISTERIO")) colorClass = "card-batisterio";
            else if (setor.includes("RECEPCAO") || setor.includes("RECEPÇÃO")) colorClass = "card-recepcao";
            else if (setor.includes("SELAMENTO")) colorClass = "card-selamento";

            return { html: `
                <div class="event-card-custom ${colorClass}" style="border-left: 4px solid currentColor; padding: 4px; min-height: 55px; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div style="font-weight: 800; font-size: 11px; color: #1e293b;">${arg.event.title}</div>
                        <div style="font-size: 9px; font-weight: 700; color: #64748b;">${ext.turno}</div>
                    </div>
                    <div class="flex -space-x-2 mt-1 justify-end">
                        ${ext.foto1 ? `<img src="${ext.foto1}" style="width: 22px; height: 22px; border-radius: 99px; border: 1px solid white; object-fit: cover;">` : ''}
                        ${ext.foto2 ? `<img src="${ext.foto2}" style="width: 22px; height: 22px; border-radius: 99px; border: 1px solid white; object-fit: cover;">` : ''}
                    </div>
                </div>
            `};
        }
    });
    calendar.render();
}

/**
 * Lógica de Filtros no Calendário
 */
function applyFilters() {
    const filterSetor = document.getElementById('filter-setor')?.value;
    const filterTurno = document.getElementById('filter-turno')?.value;
    const filterOfiId = document.getElementById('filter-oficiante')?.value;

    if (!calendar) return;
    calendar.removeAllEvents();
    
    const filtrados = escala.filter(item => {
        const matchSetor = !filterSetor || item.setor === filterSetor;
        const matchTurno = !filterTurno || item.turno === filterTurno;
        const matchOfi = !filterOfiId || String(item.id_oficiante) === String(filterOfiId);
        return matchSetor && matchTurno && matchOfi;
    });

    filtrados.forEach(e => {
        const ofi = oficiantes.find(o => String(o.id) === String(e.id_oficiante));
        calendar.addEvent({
            title: e.nome_oficiante,
            start: e.data.split('T')[0], 
            allDay: true,
            extendedProps: { 
                setor: e.setor, 
                turno: e.turno,
                foto1: ofi?.foto1 || '',
                foto2: ofi?.foto2 || ''
            }
        });
    });
}

/**
 * Busca de Dados das Planilhas
 */
async function fetchData() {
    const resOficiantes = await apiCall({ action: "listOficiantes" });
    if (resOficiantes?.status === "ok") {
        oficiantes = resOficiantes.data;
        renderOficiantes();
        updateOficianteSelect();
    }

    const resEscala = await apiCall({ action: "listEscala" });
    if (resEscala?.status === "ok") {
        escala = resEscala.data;
        renderEscalaTable();
        applyFilters(); 
    }
}

/**
 * Submissão do Formulário de Oficiante
 */
const formOficiante = document.getElementById('form-oficiante');
if (formOficiante) {
    formOficiante.onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const originalText = btn.innerText;
        btn.disabled = true;
        btn.innerText = "A guardar...";

        try {
            const id = document.getElementById('oficiante-id').value;
            const f1 = document.getElementById('fotoInput1').files[0];
            const f2 = document.getElementById('fotoInput2').files[0];
            
            const ori = id ? oficiantes.find(o => String(o.id) === String(id)) : null;
            let url1 = f1 ? await uploadParaCloudinary(f1) : (ori ? ori.foto1 : "");
            let url2 = f2 ? await uploadParaCloudinary(f2) : (ori ? ori.foto2 : "");

            const res = await apiCall({
                action: id ? "updateOficiante" : "addOficiante",
                id: id,
                nome: document.getElementById('oficiante-nome').value,
                foto1: url1,
                foto2: url2
            });

            if (res.status === "ok") {
                closeModal('modal-oficiante');
                fetchData();
            } else {
                alert(res.message);
            }
        } catch (err) {
            alert("Erro: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    };
}

/**
 * Submissão do Formulário de Escala
 */
const formEscala = document.getElementById('form-escala');
if (formEscala) {
    formEscala.onsubmit = async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;

        const ofiSelect = document.getElementById('escala-oficiante');
        const turno = document.getElementById('escala-turno').value;
        const setor = document.getElementById('escala-setor').value;
        const inputData = document.getElementById('escala-data').value;
        
        const idOrig = document.getElementById('escala-id-original').value;
        const dataOrig = document.getElementById('escala-data-original').value;
        const isEdit = (idOrig && idOrig.trim() !== "");

        let hInicio = document.getElementById('escala-hora-inicio')?.value;
        let hFim = document.getElementById('escala-hora-fim')?.value;
        
        const valSetor = setor.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (valSetor !== 'RECEPCAO' || !hInicio) {
            const horários = CONFIG_TURNOS[turno] || { inicio: "07:00", fim: "12:00" };
            hInicio = horários.inicio;
            hFim = horários.fim;
        }

        const payload = {
            action: isEdit ? "updateEscala" : "addEscala",
            data: inputData, 
            id_oficiante: ofiSelect.value,
            nome_oficiante: ofiSelect.options[ofiSelect.selectedIndex].text,
            setor: setor,
            turno: turno,
            hora_inicio: hInicio,
            hora_fim: hFim,
            id_original: idOrig,
            data_original: dataOrig,
            turno_original: document.getElementById('escala-turno-original').value
        };

        const res = await apiCall(payload);
        if (res.status === "ok") { 
            closeModal('modal-escala'); 
            fetchData(); 
        } else {
            alert("Erro: " + res.message);
        }
        btn.disabled = false;
    };
}

/**
 * Renderização das Tabelas e Listas
 */
function renderEscalaTable() {
    const tbody = document.getElementById('escala-table-body');
    if (!tbody) return;
    const escalaOrdenada = [...escala].sort((a,b) => a.data.localeCompare(b.data));

    tbody.innerHTML = escalaOrdenada.map(e => {
        const infoData = formatarDataLimpa(e.data);
        const isRecepcao = e.setor.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === 'RECEPCAO';
        const horarioInfo = isRecepcao ? `<div class="text-[10px] text-slate-500">${e.hora_inicio || ''} às ${e.hora_fim || ''}</div>` : '';

        return `
            <tr class="border-b">
                <td class="p-4 text-sm font-bold">${infoData.dataFormatada}</td>
                <td class="p-4">${e.nome_oficiante}</td>
                <td class="p-4">
                    <div class="text-[10px] font-black uppercase text-slate-500">${e.setor} - ${e.turno}</div>
                    ${horarioInfo}
                </td>
                <td class="p-4 text-right">
                    <button onclick='window.editEscalaItem(${JSON.stringify(e)})' class="text-blue-500 mr-2 hover:underline">Editar</button>
                    <button onclick="window.deleteEscalaItem('${e.id_oficiante}', '${e.data.split('T')[0]}', '${e.turno}')" class="text-red-400 hover:underline">Remover</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderOficiantes() {
    const container = document.getElementById('oficiantes-list');
    if (!container) return;
    container.innerHTML = oficiantes.map(o => `
        <div class="bg-white p-4 rounded border flex items-center gap-3">
            <img src="${o.foto1 || ''}" class="w-10 h-10 rounded-full object-cover">
            <div class="flex-1">
                <p class="font-bold text-sm">${o.nome}</p>
            </div>
            <div class="flex gap-2">
                <button onclick="window.editOficiante('${o.id}')" class="text-blue-600 hover:underline">Edit</button>
                <button onclick="window.deleteOficiante('${o.id}')" class="text-red-500 hover:underline">Apagar</button>
            </div>
        </div>
    `).join('');
}

/**
 * Gestão de Modais (Expostas Globalmente para os Botões Funcionarem)
 */
window.openEscalaModal = function() {
    const modal = document.getElementById('modal-escala');
    if (!modal) return;

    const form = document.getElementById('form-escala');
    if (form) form.reset();
    
    ['escala-id-original', 'escala-data-original', 'escala-turno-original'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const hourContainer = document.getElementById('escala-horas-container');
    if (hourContainer) hourContainer.classList.add('hidden');
    
    const submitBtn = document.querySelector('#form-escala button[type="submit"]');
    if (submitBtn) submitBtn.innerText = "Adicionar à Escala";
    
    modal.style.display = 'flex';
};

window.editEscalaItem = function(item) {
    window.openEscalaModal();
    const cleanData = item.data.includes('T') ? item.data.split('T')[0] : item.data;
    
    const map = {
        'escala-oficiante': item.id_oficiante,
        'escala-data': cleanData,
        'escala-setor': item.setor,
        'escala-turno': item.turno,
        'escala-id-original': item.id_oficiante,
        'escala-data-original': cleanData,
        'escala-turno-original': item.turno,
        'escala-hora-inicio': item.hora_inicio || '',
        'escala-hora-fim': item.hora_fim || ''
    };

    Object.keys(map).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = map[id];
    });

    const setorSelect = document.getElementById('escala-setor');
    if (setorSelect) setorSelect.dispatchEvent(new Event('change'));
    
    const submitBtn = document.querySelector('#form-escala button[type="submit"]');
    if (submitBtn) submitBtn.innerText = "Alterar Registo";
};

window.openOficianteModal = function() {
    const m = document.getElementById('modal-oficiante');
    const f = document.getElementById('form-oficiante');
    if(f) f.reset();
    const idField = document.getElementById('oficiante-id');
    if(idField) idField.value = '';
    if(m) m.style.display = 'flex';
};

window.closeModal = function(id) { 
    const m = document.getElementById(id);
    if(m) m.style.display = 'none'; 
};

function showLoading(show) { 
    const l = document.getElementById('loading');
    if(l) l.classList.toggle('hidden', !show); 
}

/**
 * Ações de Exclusão e Edição (Expostas Globalmente)
 */
window.deleteEscalaItem = async function(id, data, turno) {
    if (confirm("Tens a certeza que desejas remover este item da escala?")) {
        const res = await apiCall({ action: "deleteEscala", id_oficiante: id, data, turno });
        if (res?.status === "ok") fetchData();
    }
};

window.deleteOficiante = async function(id) {
    if (confirm("Desejas excluir permanentemente este oficiante?")) {
        const res = await apiCall({ action: "deleteOficiante", id });
        if (res?.status === "ok") fetchData();
    }
};

window.editOficiante = function(id) {
    const o = oficiantes.find(of => String(of.id) === String(id));
    if (!o) return;
    window.openOficianteModal();
    const idF = document.getElementById('oficiante-id');
    const nomF = document.getElementById('oficiante-nome');
    if(idF) idF.value = o.id;
    if(nomF) nomF.value = o.nome;
};

/**
 * Navegação por Abas (Exposta Globalmente)
 */
window.switchTab = function(tab) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`sec-${tab}`)?.classList.remove('hidden');
    if (tab === 'calendar' && calendar) {
        setTimeout(() => { calendar.updateSize(); }, 200);
    }
};

/**
 * Atualização Dinâmica de Dropdowns
 */
function updateOficianteSelect() {
    ['escala-oficiante', 'filter-oficiante'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const isFilter = id.includes('filter');
        el.innerHTML = (isFilter ? '<option value="">Todos</option>' : '<option value="">Selecione...</option>') + 
            oficiantes.map(o => `<option value="${o.id}">${o.nome}</option>`).join('');
    });
}

/**
 * Exportação para PDF (jsPDF + AutoTable) - Exposta Globalmente
 */
window.generateProfessionalPDF = function() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text("Escala Oficial do Templo", 15, 20);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-PT')}`, 15, 27);

    const rows = escala.sort((a,b) => a.data.localeCompare(b.data)).map(e => {
        const info = formatarDataLimpa(e.data);
        return [info.dataFormatada, e.nome_oficiante, e.setor, e.turno];
    });

    doc.autoTable({ 
        head: [['Data', 'Oficiante', 'Setor', 'Turno']], 
        body: rows, 
        startY: 35,
        theme: 'striped',
        headStyles: { fillStyle: [30, 41, 59] }
    });
    
    doc.save("Escala_Templo.pdf");
};

/**
 * Google Auth Callback (Exposta Globalmente)
 */
window.handleCredentialResponse = function(response) {
    try {
        const payload = JSON.parse(atob(response.credential.split('.')[1]));
        currentUser = payload;
        document.getElementById('loginContainer')?.classList.add('hidden');
        document.getElementById('userInfo')?.classList.remove('hidden');
        const userLabel = document.getElementById('userName');
        if(userLabel) userLabel.innerText = payload.name;
        
        // Mostrar elementos restritos a administradores
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    } catch (err) {
        console.error("Erro ao processar login Google:", err);
    }
};
