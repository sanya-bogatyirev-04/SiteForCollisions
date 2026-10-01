// ===== Константы =====

/**
 * Известные коды разделов проекта — по ним из имени XML-файла определяется
 * пара конфликтующих разделов
 */
const KNOWN_DISCIPLINES = ["АР", "КР", "ВК", "ЭОМ", "ВиК", "ОТМ", "СС", "АПТ-ВПВ", "КЖ", "АУПТ", "ИТП"];

/**
 * Те же коды, отсортированные от длинных к коротким: искать надо сначала
 * длинные, иначе "АПТ-ВПВ" будет распознан как более короткий код внутри него
 */
const DISCIPLINES_BY_LENGTH = [...KNOWN_DISCIPLINES].sort((a, b) => b.length - a.length);

/**
 * Подставляется вместо раздела, если разобрать имя файла не удалось
 */
const NOT_DEFINED = "Не опр.";

/**
 * Отрезает ведущий "<номер>_" и/или замыкающий "_<номер>" от имени файла
 */
const FILE_NAME_NUMBER_RE = /^\d+(\.\d+)?_|_\d+(\.\d+)?$/g;

/**
 * Название подпапки с архивом (лежит прямо внутри выбранной папки). Внутри —
 * ПЛОСКО, без вложенных папок по датам — лежат JSON-отчёты вида
 * "<имя папки>_дд-мм-гггг.json" (см. exportReport, кнопка "Выгрузить отчёт").
 */
const ARCHIVE_FOLDER_NAME = '!АРХИВ';

/**
 * Имя файла архивного отчёта: "<имя папки>_дд-мм-гггг.json"
 */
const REPORT_FILE_NAME_RE = /^(.+)_(\d{2})-(\d{2})-(\d{4})\.json$/i;

// ===== Элементы страницы =====

const totalCollisionsValue = document.getElementById('total-collisions-value');
const changePercentValue = document.getElementById('change-percent-value');
const periodDeltaValue = document.getElementById('period-delta-value');

const xmlFileInput = document.getElementById('xml-file-input');
const btnSelectFolder = document.getElementById('btn-select-folder');
const btnClearFolders = document.getElementById('btn-clear-folders');
const folderDropdown = document.getElementById('folder-dropdown');
const folderDropdownToggle = document.getElementById('folder-dropdown-toggle');
const folderDropdownLabel = document.getElementById('folder-dropdown-label');
const folderDropdownList = document.getElementById('folder-dropdown-list');

const startDateDropdown = document.getElementById('start-date-dropdown');
const startDateToggle = document.getElementById('start-date-toggle');
const startDateLabel = document.getElementById('start-date-label');
const startDateList = document.getElementById('start-date-list');

const endDateDropdown = document.getElementById('end-date-dropdown');
const endDateToggle = document.getElementById('end-date-toggle');
const endDateLabel = document.getElementById('end-date-label');
const endDateList = document.getElementById('end-date-list');

const btnExportReport = document.getElementById('btn-export-report');
const btnExportPdf = document.getElementById('btn-export-pdf');

const collisionMatrixBody = document.getElementById('collision-matrix-body');
const sectionTableBody = document.getElementById('section-table-body');
const totalChartBody = document.getElementById('total-chart-body');
const disciplineChartBody = document.getElementById('discipline-chart-body');

const disciplineFilterList = document.getElementById('discipline-filter-list');

// ===== Состояние =====

let folders = [];
let activeFolderIndex = -1;
let archivePoints = [];
let pinnedDisciplines = new Set();
let expandedSections = new Set(); // разделы, раскрытые в "Таблице по разделам"
let disciplineFilter = new Set();
let startDateIndex = -1;
let endDateIndex = -1;
let totalCollisions = 'N';
let changePercent = 0;
let dragEnterCounter = 0;
let chartTooltip = null;

const isSecureLocalContext = (location.protocol === 'https:')
    || ((location.protocol === 'http:') && (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
const supportsDirectoryPicker = typeof window.showDirectoryPicker === 'function';
const canWriteFiles = Boolean(btnExportReport) && isSecureLocalContext && supportsDirectoryPicker;

// ===== Цвета для разделов в графике =====

/**
 * Фиксированные цвета для известных разделов (Tableau 10)
 */
const DISCIPLINE_COLOR_MAP = {
    'АР': '#1f77b4',
    'КР': '#ff7f0e',
    'ВК': '#2ca02c',
    'ЭОМ': '#d62728',
    'ВиК': '#9467bd',
    'ОТМ': '#8c564b',
    'СС': '#e377c2',
    'АПТ-ВПВ': '#000000',
    'КЖ': '#bcbd22',
    'АУПТ': '#17becf',
    'ИТП': '#cf17b7'
};

/**
 * Дополнительные цвета для разделов, не входящих в KNOWN_DISCIPLINES
 */
const EXTRA_COLORS = [
    '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5',
    '#c49c94', '#f7b6d2', '#c7c7c7', '#dbdb8d', '#9edae5'
];

let extraColorIndex = 0;
const disciplineColorCache = {};

/**
 * Возвращает цвет для заданного раздела.
 * Для известных разделов – фиксированный, для остальных – из дополнительной палитры или случайный.
 */
function getDisciplineColor(discipline) {
    if (DISCIPLINE_COLOR_MAP.hasOwnProperty(discipline)) {
        return DISCIPLINE_COLOR_MAP[discipline];
    }
    if (disciplineColorCache.hasOwnProperty(discipline)) {
        return disciplineColorCache[discipline];
    }
    let color;
    if (extraColorIndex < EXTRA_COLORS.length) {
        color = EXTRA_COLORS[extraColorIndex++];
    } else {
        const hue = Math.floor(Math.random() * 360);
        color = `hsl(${hue}, 75%, 60%)`;
    }
    disciplineColorCache[discipline] = color;
    return color;
}

// ===== Окраска значений по знаку =====

function setColor(element, value) {
    element.classList.remove('value-positive', 'value-negative', 'value-neutral');
    if (value > 0) {
        element.classList.add('value-negative');
    } else if (value === 0) {
        element.classList.add('value-neutral');
    } else {
        element.classList.add('value-positive');
    }
}

// ===== Сравнение по GUID =====

function computeComparisonStats(startData, endData) {
    if (!startData || !endData) return null;
    if (!startData.guidEntries || !startData.guidEntries.length) return null;
    if (!endData.guidEntries || !endData.guidEntries.length) return null;

    const startGuids = new Set(getFilteredGuidEntriesFromPoint(startData).map(e => e.guid));
    const endGuids = new Set(getFilteredGuidEntriesFromPoint(endData).map(e => e.guid));

    let active = 0, freshCount = 0, resolved = 0;
    endGuids.forEach((guid) => {
        if (startGuids.has(guid)) active++;
        else freshCount++;
    });
    startGuids.forEach((guid) => {
        if (!endGuids.has(guid)) resolved++;
    });
    return { active, new: freshCount, resolved };
}

function renderComparisonStats(startData, endData) {
    const stats = computeComparisonStats(startData, endData);
    document.getElementById('active').textContent = stats ? stats.active : '—';
    document.getElementById('new').textContent = stats ? stats.new : '—';
    document.getElementById('resolved').textContent = stats ? stats.resolved : '—';
}

// ===== Разбор пары разделов из имени файла =====

function findDisciplineInPart(part) {
    const cleaned = part.replace(/^[_ ]+|[_ ]+$/g, '');
    if (!cleaned) return null;
    const tokens = cleaned.split('_').filter(Boolean);
    for (const token of tokens) {
        if (KNOWN_DISCIPLINES.includes(token)) return token;
    }
    for (const code of DISCIPLINES_BY_LENGTH) {
        if (cleaned.includes(code)) return code;
    }
    return null;
}

function parseDisciplinePair(fileName) {
    if (!fileName) return [null, null];
    const trimmed = fileName.replace(FILE_NAME_NUMBER_RE, '');
    let firstDiscipline = null;
    let remainder = '';
    for (const code of DISCIPLINES_BY_LENGTH) {
        if (trimmed.startsWith(code)) {
            const nextChar = trimmed.slice(code.length, code.length + 1);
            if (nextChar === '' || nextChar === '_' || nextChar === '-') {
                firstDiscipline = code;
                remainder = trimmed.slice(code.length);
                break;
            }
        }
    }
    if (firstDiscipline === null) return [null, null];
    const secondDiscipline = findDisciplineInPart(remainder);
    return secondDiscipline ? [firstDiscipline, secondDiscipline] : [null, null];
}

// ===== Чтение файлов выбранной папки =====

function collectClashGuids(file) {
    return file.text().then((text) => {
        const xmlDoc = new DOMParser().parseFromString(text, 'application/xml');
        if (xmlDoc.querySelector('parsererror')) {
            console.error(`Не удалось разобрать файл: ${file.name}`);
            return [];
        }
        return Array.from(xmlDoc.getElementsByTagName('clashresult'))
            .map((node) => node.getAttribute('guid'))
            .filter(Boolean);
    });
}

function buildClashRecords(files) {
    return Promise.all(files.map((file) => {
        const nameWithoutExtension = file.name.replace(/\.xml$/i, '');
        const [firstDiscipline, secondDiscipline] = parseDisciplinePair(nameWithoutExtension);
        return collectClashGuids(file).then((guids) => ({
            // имя файла нужно для раскрывающегося списка файлов в "Таблице по разделам"
            fileName: file.name,
            discipline1: firstDiscipline || NOT_DEFINED,
            discipline2: secondDiscipline || NOT_DEFINED,
            total: guids.length,
            guids,
        }));
    }));
}

function getGuidEntries(records) {
    const entries = [];
    records.forEach((record) => {
        (record.guids || []).forEach((guid) => {
            entries.push({ guid, discipline1: record.discipline1, discipline2: record.discipline2 });
        });
    });
    return entries;
}

function filterGuidEntriesByDiscipline(entries) {
    if (disciplineFilter.size === KNOWN_DISCIPLINES.length) return entries;
    return entries.filter((entry) => isDisciplineVisible(entry.discipline1) && isDisciplineVisible(entry.discipline2));
}

function parseReportFileName(fileName) {
    const match = REPORT_FILE_NAME_RE.exec(fileName);
    if (!match) return null;
    const [, folderNamePart, day, month, year] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(date.getTime())) return null;
    return { folderNamePart, dateKey: `${day}-${month}-${year}`, date };
}

function isArchiveReportFile(file, folderName) {
    if (!file.name.toLowerCase().endsWith('.json')) return false;
    const segments = (file.webkitRelativePath || '').split('/');
    if (segments.length !== 3) return false;
    if (segments[1] !== ARCHIVE_FOLDER_NAME) return false;
    const parsed = parseReportFileName(file.name);
    return Boolean(parsed) && parsed.folderNamePart === folderName;
}

function buildArchivePoints(allFiles, folderName) {
    const reportFiles = allFiles.filter((file) => isArchiveReportFile(file, folderName));
    return Promise.all(
        reportFiles.map((file) =>
            file.text().then((text) => {
                let data;
                try { data = JSON.parse(text); } catch (e) { console.error(`Не удалось разобрать отчёт ${file.name}:`, e); return null; }
                const parsed = parseReportFileName(file.name);
                const guidEntries = Array.isArray(data.guids)
                    ? data.guids.filter((entry) => entry && typeof entry.guid === 'string')
                    : [];
                // "files" есть только в отчётах, выгруженных после появления
                // списка файлов в "Таблице по разделам"; в старых отчётах его
                // нет — тогда для архивной даты список файлов просто недоступен
                const files = Array.isArray(data.files)
                    ? data.files
                        .filter((entry) => entry && typeof entry.fileName === 'string')
                        .map((entry) => ({
                            fileName: entry.fileName,
                            discipline1: entry.discipline1 || NOT_DEFINED,
                            discipline2: entry.discipline2 || NOT_DEFINED,
                            total: Number(entry.total) || 0,
                        }))
                    : [];
                return {
                    key: parsed.dateKey,
                    date: parsed.date,
                    total: Number(data.total) || 0,
                    sections: data.sections && typeof data.sections === 'object' ? data.sections : {},
                    pairs: data.pairs && typeof data.pairs === 'object' ? data.pairs : {},
                    guidEntries,
                    files,
                };
            })
        )
    ).then((list) => list.filter(Boolean).sort((a, b) => a.date - b.date));
}

// ===== Сводные данные по разделам =====

function sectionsToClashRecords(sections) {
    return Object.entries(sections).map(([discipline1, total]) => ({
        discipline1,
        discipline2: '',
        total,
    }));
}

function getPresentDisciplines(records) {
    const present = new Set();
    records.forEach((record) => {
        present.add(record.discipline1);
        present.add(record.discipline2);
    });
    present.delete('');
    const known = KNOWN_DISCIPLINES.filter((d) => present.has(d));
    const other = [...present].filter((d) => !KNOWN_DISCIPLINES.includes(d)).sort();
    return [...known, ...other];
}

function isDisciplineVisible(discipline) {
    return !KNOWN_DISCIPLINES.includes(discipline) || disciplineFilter.has(discipline);
}

function filterRecordsByDiscipline(records) {
    if (disciplineFilter.size === KNOWN_DISCIPLINES.length) return records;
    return records.filter((record) => isDisciplineVisible(record.discipline1) && isDisciplineVisible(record.discipline2));
}

function getFilteredArchivePoint(point) {
    if (!point) return point;
    if (disciplineFilter.size === KNOWN_DISCIPLINES.length) return point;
    const pairs = {};
    const sections = {};
    let total = 0;
    Object.entries(point.pairs || {}).forEach(([key, value]) => {
        const [first, second] = key.split('|');
        if (!isDisciplineVisible(first) || !isDisciplineVisible(second)) return;
        pairs[key] = value;
        total += value;
        sections[first] = (sections[first] || 0) + value;
        if (second !== first) sections[second] = (sections[second] || 0) + value;
    });
    return { ...point, sections, pairs, total };
}

function getDisciplineTotal(records, discipline) {
    let total = 0;
    records.forEach((record) => {
        if (record.discipline1 === discipline) total += record.total;
        if (record.discipline2 === discipline && record.discipline1 !== discipline) total += record.total;
    });
    return total;
}

function getPairKey(first, second) {
    return [first, second].sort().join('|');
}

function buildCollisionMatrix(records, disciplines) {
    const matrix = {};
    disciplines.forEach((row) => {
        matrix[row] = {};
        disciplines.forEach((col) => {
            const straight = records
                .filter(r => r.discipline1 === row && r.discipline2 === col)
                .reduce((s, r) => s + r.total, 0);
            if (row === col) {
                matrix[row][col] = straight;
                return;
            }
            const reverse = records
                .filter(r => r.discipline1 === col && r.discipline2 === row)
                .reduce((s, r) => s + r.total, 0);
            matrix[row][col] = straight + reverse;
        });
    });
    return matrix;
}

// ===== Новая цветовая шкала для ячеек =====

function getHeatColor(value) {
    if (value === 0) return '#ebebeb91';
    if (value < 20) return '#bffbcd';
    if (value <= 100) return '#fcd695';
    return '#fbbebe';
}

// ===== Рендер ячеек =====

function renderDeltaIndicator(value, referenceValue) {
    if (referenceValue === null || referenceValue === undefined) return '';
    const delta = value - referenceValue;
    if (delta === 0) return '';
    const isDecrease = delta < 0;
    const triangleClass = isDecrease ? 'value-delta__triangle--down' : 'value-delta__triangle--up';
    const colorClass = isDecrease ? 'value-delta--decrease' : 'value-delta--increase';
    return `<span class="value-delta ${colorClass}"><span class="value-delta__triangle ${triangleClass}"></span>${delta}</span>`;
}

function renderHeatCell(value, extraClass = '', referenceValue = undefined) {
    const cellClass = `heat-cell${extraClass ? ' ' + extraClass : ''}`;
    const color = getHeatColor(value);
    const deltaIndicator = renderDeltaIndicator(value, referenceValue);
    if (value === 0) {
        return `<td class="${cellClass} heat-cell--empty" style="background-color: ${color};">-${deltaIndicator}</td>`;
    }
    var textColor = '#000000';
    if (value < 20) textColor = '#00c02a';
    else if (value <= 100) textColor = '#bb7600';
    else textColor = '#af0000';

    return `<td class="${cellClass}" style="background-color: ${color}; color: ${textColor}; font-weight: 500;">${value}${deltaIndicator}</td>`;
}

// ===== Матрица конфликтов =====

function renderCollisionMatrix(pairs, referencePairs) {
    collisionMatrixBody.innerHTML = '';

    const disciplinesSet = new Set();
    const allPairs = { ...pairs, ...referencePairs };
    Object.keys(allPairs).forEach(key => {
        const [first, second] = key.split('|');
        if (first) disciplinesSet.add(first);
        if (second) disciplinesSet.add(second);
    });
    const disciplines = [...disciplinesSet].sort((a, b) => {
        const indexA = KNOWN_DISCIPLINES.indexOf(a);
        const indexB = KNOWN_DISCIPLINES.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });
    if (!disciplines.length) return;

    const matrix = {};
    disciplines.forEach(row => {
        matrix[row] = {};
        disciplines.forEach(col => {
            matrix[row][col] = 0;
        });
    });
    Object.entries(pairs).forEach(([key, value]) => {
        const [first, second] = key.split('|');
        if (first && second && matrix[first] !== undefined && matrix[second] !== undefined) {
            matrix[first][second] += value;
            if (first !== second) matrix[second][first] += value;
        }
    });

    const pairReference = (first, second) => {
        if (!referencePairs) return undefined;
        const key = getPairKey(first, second);
        return referencePairs[key];
    };

    let html = '<div class="matrix-table-wrapper"><table class="matrix-table"><thead><tr><th></th>';
    disciplines.forEach(d => { html += `<th>${d}</th>`; });
    html += '</tr></thead><tbody>';

    disciplines.forEach((row, rowIndex) => {
        html += `<tr><th>${row}</th>`;
        disciplines.forEach((col, colIndex) => {
            if (colIndex > rowIndex) {
                html += '<td class="matrix-table__blank-cell"></td>';
                return;
            }
            const value = matrix[row][col];
            const refValue = pairReference(row, col);
            html += renderHeatCell(value, '', refValue);
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    collisionMatrixBody.innerHTML = html;
}

// ===== Сводная таблица по разделам =====

/**
 * Экранирование текста для вставки в HTML (имена файлов приходят от пользователя)
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Файлы, относящиеся к разделу: файл "03_АР_Окна Двери-ВиК_10.xml" относится
 * и к АР, и к ВиК, поэтому попадает в списки обоих разделов
 */
function getDisciplineFiles(files, discipline) {
    return files
        .filter((file) => file.discipline1 === discipline || file.discipline2 === discipline)
        .sort((a, b) => b.total - a.total || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

/**
 * files — список файлов конечной даты (для архивной даты есть только в
 * отчётах, выгруженных с полем "files"); если списка нет — строки не
 * раскрываются. referenceData.files (если есть) — для индикатора изменения
 * по каждому файлу.
 */
function renderSectionTable(records, referenceData, files = []) {
    sectionTableBody.innerHTML = '';
    const refRecords = referenceData ? sectionsToClashRecords(referenceData.sections) : [];
    const disciplines = getPresentDisciplines([...records, ...refRecords]);
    if (!disciplines.length) return;
    const rows = disciplines.map(d => ({ discipline: d, total: getDisciplineTotal(records, d) }));
    rows.sort((a, b) => b.total - a.total);

    const refFiles = referenceData && Array.isArray(referenceData.files) && referenceData.files.length
        ? new Map(referenceData.files.map((file) => [file.fileName, file.total]))
        : null;

    let html = '<div class="section-table-wrapper"><table class="section-table">'
        + '<colgroup><col class="section-table__col-name"><col class="section-table__col-total"></colgroup>'
        + '<thead><tr><th>Раздел</th><th>Всего</th></tr></thead><tbody>';
    rows.forEach(row => {
        const refValue = referenceData ? referenceData.sections?.[row.discipline] : undefined;
        const disciplineFiles = getDisciplineFiles(files, row.discipline);
        const isExpandable = disciplineFiles.length > 0;
        const isExpanded = isExpandable && expandedSections.has(row.discipline);
        const rowClass = 'section-table__row'
            + (isExpandable ? ' section-table__row--expandable' : '')
            + (isExpanded ? ' section-table__row--expanded' : '');
        const rowTitle = isExpandable ? '' : ' title="Нет данных по файлам для выбранной даты"';
        html += `<tr class="${rowClass}" data-discipline="${escapeHtml(row.discipline)}"${rowTitle}>`;
        html += `<td class="section-table__discipline"><span class="section-table__toggle">▸</span>${escapeHtml(row.discipline)}</td>`;
        html += renderHeatCell(row.total, '', refValue);
        html += '</tr>';

        disciplineFiles.forEach((file) => {
            const refFileValue = refFiles ? (refFiles.get(file.fileName) || 0) : undefined;
            const name = escapeHtml(file.fileName);
            html += `<tr class="section-table__file-row" data-parent="${escapeHtml(row.discipline)}"${isExpanded ? '' : ' hidden'}>`;
            html += `<td class="section-table__file-name" title="${name}">${name}</td>`;
            html += `<td class="section-table__file-count">${file.total}${renderDeltaIndicator(file.total, refFileValue)}</td>`;
            html += '</tr>';
        });
    });
    html += '</tbody></table></div>';
    sectionTableBody.innerHTML = html;
}

/**
 * Раскрытие/сворачивание списка файлов по клику на раздел — без полной
 * перерисовки таблицы (прокрутка сохраняется)
 */
function setupSectionTableInteractions() {
    sectionTableBody.addEventListener('click', (event) => {
        const row = event.target.closest('.section-table__row--expandable');
        if (!row) return;
        const discipline = row.dataset.discipline;
        const isExpanded = !expandedSections.has(discipline);
        if (isExpanded) expandedSections.add(discipline);
        else expandedSections.delete(discipline);
        row.classList.toggle('section-table__row--expanded', isExpanded);
        sectionTableBody.querySelectorAll('.section-table__file-row').forEach((fileRow) => {
            if (fileRow.dataset.parent === discipline) fileRow.hidden = !isExpanded;
        });
    });
}

// ===== Графики =====

function renderTotalChart(points, startIdx, endIdx) {
    totalChartBody.innerHTML = '';
    if (!points.length) return;
    const chartPoints = points.map((p) => ({ label: p.key, value: p.total }));

    const width = 1300, height = 240;
    const padding = { top: 16, right: 20, bottom: 45, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const chartBottom = padding.top + chartHeight;
    const maxValue = Math.max(1, ...chartPoints.map(p => p.value));
    const stepX = chartPoints.length > 1 ? chartWidth / (chartPoints.length - 1) : 0;

    // Координаты точек
    const coords = chartPoints.map((p, i) => ({
        x: padding.left + stepX * i,
        y: chartBottom - (p.value / maxValue) * chartHeight,
        label: p.label,
        value: p.value,
        index: i,
    }));

    // Индексы для подписей дат (максимум 5)
    let labelIndices = [];
    const total = coords.length;
    if (total <= 5) {
        labelIndices = coords.map((_, i) => i);
    } else {
        const step = (total - 1) / 4;
        for (let i = 0; i < 5; i++) {
            const idx = Math.round(i * step);
            labelIndices.push(idx);
        }
    }

    // Шкала Y (4 равных шага)
    const yTickCount = 4;
    const yTicks = [];
    for (let i = 0; i <= yTickCount; i++) {
        const val = Math.round((maxValue / yTickCount) * i);
        yTicks.push(val);
    }
    let yAxisLabels = '';
    yTicks.forEach(val => {
        const yPos = chartBottom - (val / maxValue) * chartHeight;
        yAxisLabels += `<text x="${padding.left - 8}" y="${yPos + 4}" class="chart-axis-label" text-anchor="end" fill="#333">${val}</text>`;
        yAxisLabels += `<line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#ddd" stroke-width="1" />`;
    });

    // Подсветка выбранного периода
    let highlightRect = '';
    if (startIdx >= 0 && endIdx >= 0 && startIdx !== endIdx) {
        const x1 = padding.left + stepX * Math.min(startIdx, endIdx);
        const x2 = padding.left + stepX * Math.max(startIdx, endIdx);
        const rectWidth = x2 - x1;
        if (rectWidth > 0) {
            highlightRect = `<rect x="${x1}" y="${padding.top}" width="${rectWidth}" height="${chartHeight}" class="chart-highlight-rect" />`;
        }
    }

    // Точки
    let markers = '';
    coords.forEach((coord, index) => {
        const isStart = index === startIdx;
        const isEnd = index === endIdx;
        const isSelected = isStart || isEnd;
        const pointClass = isSelected ? ' chart-point--selected' : '';
        markers += `<circle cx="${coord.x}" cy="${coord.y}" r="${isSelected ? 5 : 3}" class="chart-point${pointClass}" data-index="${index}" data-label="${coord.label}" data-value="${coord.value}" data-cx="${coord.x}" data-cy="${coord.y}" />`;
    });

    // Линия-указатель при наведении
    const hoverLine = `<line class="chart-hover-line" x1="0" y1="0" x2="0" y2="0" style="display: none;" stroke="#123a6e" stroke-width="2" stroke-dasharray="6 5" />`;

    // Подписи дат (внизу)
    let axisLabels = '';
    labelIndices.forEach((idx) => {
        const coord = coords[idx];
        if (!coord) return;
        axisLabels += `<text x="${coord.x}" y="${chartBottom + 16}" class="chart-axis-label" text-anchor="middle" fill="#333">${coord.label}</text>`;
    });

    totalChartBody.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
            ${highlightRect}
            ${yAxisLabels}
            <polyline points="${coords.map(c => `${c.x},${c.y}`).join(' ')}" class="chart-line" />
            ${markers}
            ${hoverLine}
            ${axisLabels}
        </svg>
    `;
}

// ===== График динамики по разделам (с сеткой и подписями) =====

function renderDisciplineChart(points, startIdx, endIdx) {
    disciplineChartBody.innerHTML = '';
    if (!points.length) return;
    const allRecords = points.flatMap(p => sectionsToClashRecords(p.sections));
    let disciplines = getPresentDisciplines(allRecords);
    // Сортируем по алфавиту
    disciplines = disciplines.slice().sort((a, b) => a.localeCompare(b));
    if (!disciplines.length) return;

    // Подготовка данных линий
    const series = disciplines.map(d => {
        const values = points.map(p => p.sections[d] || 0);
        return { discipline: d, values };
    });
    series.forEach(line => {
            line.color = getDisciplineColor(line.discipline);
        }
    );

    // Размеры и отступы (увеличили left и bottom для подписей)
    const width = 900, height = 200;
    const padding = { top: 16, right: 20, bottom: 45, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const chartBottom = padding.top + chartHeight;
    const maxValue = Math.max(1, ...series.flatMap(line => line.values));
    const pointsCount = points.length;
    const stepX = pointsCount > 1 ? chartWidth / (pointsCount - 1) : 0;
    const axisLabels = points.map(p => p.key);

    // Сетка Y (4 горизонтальные линии с подписями)
    const yTickCount = 4;
    const yTicks = [];
    for (let i = 0; i <= yTickCount; i++) {
        const val = Math.round((maxValue / yTickCount) * i);
        yTicks.push(val);
    }
    let yAxisLabels = '';
    yTicks.forEach(val => {
        const yPos = chartBottom - (val / maxValue) * chartHeight;
        yAxisLabels += `<text x="${padding.left - 8}" y="${yPos + 4}" class="chart-axis-label" text-anchor="end" fill="#333">${val}</text>`;
        yAxisLabels += `<line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#ddd" stroke-width="1" />`;
    });

    // Подписи дат (не более 5 равномерно распределённых)
    let labelIndices = [];
    const totalLabels = axisLabels.length;
    if (totalLabels <= 5) {
        labelIndices = axisLabels.map((_, i) => i);
    } else {
        const step = (totalLabels - 1) / 4;
        for (let i = 0; i < 5; i++) {
            const idx = Math.round(i * step);
            labelIndices.push(idx);
        }
    }
    let axisLabelsHTML = '';
    labelIndices.forEach(idx => {
        const x = padding.left + stepX * idx;
        axisLabelsHTML += `<text x="${x}" y="${chartBottom + 16}" class="chart-axis-label" text-anchor="middle" fill="#333">${axisLabels[idx]}</text>`;
    });

    // Линии и точки для каждой дисциплины
    let lines = '', markers = '';
    series.forEach(line => {
        const coords = line.values.map((val, i) => ({
            x: padding.left + stepX * i,
            y: chartBottom - (val / maxValue) * chartHeight,
        }));
        const linePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
        lines += `<polyline points="${linePoints}" class="chart-line" data-discipline="${line.discipline}" data-stroke="${line.color}" style="stroke: ${line.color}" />`;
        coords.forEach((coord, i) => {
            const isStart = i === startIdx;
            const isEnd = i === endIdx;
            const isSelected = isStart || isEnd;
            const pointStroke = line.color;
            const pointFill = isSelected ? '#ffffff' : line.color;
            const strokeWidth = isSelected ? 2.5 : 0;
            const value = line.values[i];
            markers += `<circle cx="${coord.x}" cy="${coord.y}" r="${isSelected ? 5 : 3}" class="chart-point" style="fill: ${pointFill}; stroke: ${pointStroke}; stroke-width: ${strokeWidth};" data-discipline="${line.discipline}" data-value="${value}" data-label="${axisLabels[i]}" data-index="${i}" data-cx="${coord.x}" data-cy="${coord.y}" data-fill="${pointFill}" data-stroke="${pointStroke}" />`;
        });
    });

    // Легенда
    const legend = series.map(line => `
        <label class="chart-legend__item" data-discipline="${line.discipline}">
            <input type="checkbox" class="chart-legend__checkbox" data-discipline="${line.discipline}" ${pinnedDisciplines.has(line.discipline) ? 'checked' : ''}>
            <span class="chart-legend__swatch" style="background: ${line.color}"></span>${line.discipline}
        </label>
    `).join('');

    // Собираем SVG
    disciplineChartBody.innerHTML = `
        <div class="chart-legend">${legend}</div>
        <svg viewBox="0 0 ${width} ${height}" class="chart-svg" preserveAspectRatio="xMidYMid meet">
            ${yAxisLabels}
            <line x1="${padding.left}" y1="${chartBottom}" x2="${width - padding.right}" y2="${chartBottom}" class="chart-axis-line" />
            <line x1="${padding.left}" y1="${chartBottom}" x2="${padding.left}" y2="${padding.top - 6}" class="chart-axis-line" />
            ${lines}
            ${markers}
            ${axisLabelsHTML}
        </svg>
    `;
}

// ===== Подсказка и легенда графика по разделам =====

function getOrCreateChartTooltip() {
    if (!chartTooltip) {
        chartTooltip = document.createElement('div');
        chartTooltip.className = 'custom-tooltip';
        document.body.appendChild(chartTooltip);
    }
    return chartTooltip;
}

function showChartTooltip(event, label, value, discipline) {
    const tooltip = getOrCreateChartTooltip();
    // Строим содержимое
    let html = '';
    if (label) html += `<div class="date">${label}</div>`;
    if (value !== undefined && value !== null) html += `<div class="value">${value}</div>`;
    if (discipline) html += `<div class="discipline">${discipline}</div>`;
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    // Позиционирование (слева-снизу, отступ 4px)
    let left = event.clientX - tooltip.offsetWidth - 4;
    let top = event.clientY + 4;

    if (left < 0) {
        left = event.clientX + 4;
    }
    if (left + tooltip.offsetWidth > window.innerWidth) {
        left = event.clientX - tooltip.offsetWidth - 4;
        if (left < 0) left = 4;
    }
    if (top + tooltip.offsetHeight > window.innerHeight) {
        top = event.clientY - tooltip.offsetHeight - 4;
    }
    if (top < 0) top = 4;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
}

function hideChartTooltip() {
    if (chartTooltip) chartTooltip.style.display = 'none';
}

function applyDisciplineHighlight(hoverDiscipline) {
    const active = hoverDiscipline ? new Set([hoverDiscipline]) : pinnedDisciplines;
    const noFilter = active.size === 0;
    disciplineChartBody.querySelectorAll('[data-discipline]').forEach(el => {
        if (!el.dataset.stroke && !el.dataset.fill) return;
        const isActive = noFilter || active.has(el.dataset.discipline);
        if (el.dataset.stroke) el.style.stroke = isActive ? el.dataset.stroke : 'var(--color-muted)';
        if (el.dataset.fill) el.style.fill = isActive ? el.dataset.fill : 'var(--color-muted)';
    });
}

function setupDisciplineChartInteractions() {
    disciplineChartBody.addEventListener('mousemove', (event) => {
        const target = event.target.closest('[data-discipline]');
        if (!target) { hideChartTooltip(); return; }
        const discipline = target.dataset.discipline;
        const value = target.dataset.value;
        const label = target.dataset.label;
        showChartTooltip(event, label, value, discipline);  // три параметра
    });
    disciplineChartBody.addEventListener('mouseleave', hideChartTooltip);
    disciplineChartBody.addEventListener('mouseover', (event) => {
        const legendItem = event.target.closest('.chart-legend__item');
        if (legendItem) applyDisciplineHighlight(legendItem.dataset.discipline);
    });
    disciplineChartBody.addEventListener('mouseout', (event) => {
        const legendItem = event.target.closest('.chart-legend__item');
        if (legendItem && !legendItem.contains(event.relatedTarget)) applyDisciplineHighlight(null);
    });
    disciplineChartBody.addEventListener('change', (event) => {
        const checkbox = event.target.closest('.chart-legend__checkbox');
        if (!checkbox) return;
        if (checkbox.checked) pinnedDisciplines.add(checkbox.dataset.discipline);
        else pinnedDisciplines.delete(checkbox.dataset.discipline);
        applyDisciplineHighlight(null);
    });
}

// ===== Взаимодействие с графиком динамики (кастомная подсказка) =====

function setupTotalChartInteractions() {
    const container = totalChartBody;
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    tooltip.style.position = 'fixed';
    tooltip.style.zIndex = '1000';
    tooltip.style.padding = '8px 12px';
    tooltip.style.background = '#ffffff';
    tooltip.style.border = '2px solid #000000';
    tooltip.style.borderRadius = '6px';
    tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    tooltip.style.fontFamily = '"Barlow Condensed", "Segoe UI", Arial, sans-serif';
    tooltip.style.fontSize = '14px';
    tooltip.style.fontWeight = '600';
    tooltip.style.color = '#000000';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.display = 'none';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.lineHeight = '1.4';
    document.body.appendChild(tooltip);

    container.addEventListener('mouseover', (event) => {
        const circle = event.target.closest('.chart-point');
        if (!circle) return;
        const label = circle.dataset.label || '';
        const value = circle.dataset.value || '';

        tooltip.innerHTML = `<div class="date">${label}</div><div class="value">${value}</div>`;
        tooltip.style.display = 'block';

        // Позиционируем относительно мыши, а не точки
        let left = event.clientX - tooltip.offsetWidth - 4;
        let top = event.clientY + 4;

        // Корректировка по горизонтали
        if (left < 0) {
            left = event.clientX + 4;
        }
        if (left + tooltip.offsetWidth > window.innerWidth) {
            left = event.clientX - tooltip.offsetWidth - 4;
            if (left < 0) left = 4;
        }
        // Корректировка по вертикали
        if (top + tooltip.offsetHeight > window.innerHeight) {
            top = event.clientY - tooltip.offsetHeight - 4;
        }
        if (top < 0) top = 4;

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';

        // Линия-указатель (оставляем как есть)
        const svg = container.querySelector('svg');
        if (svg) {
            const hoverLine = svg.querySelector('.chart-hover-line');
            if (hoverLine) {
                const cx = parseFloat(circle.getAttribute('cx'));
                const cy = parseFloat(circle.getAttribute('cy'));
                const padding = { top: 22, bottom: 45 };
                const viewBox = svg.viewBox.baseVal;
                hoverLine.setAttribute('x1', cx);
                hoverLine.setAttribute('x2', cx);
                hoverLine.setAttribute('y1', padding.top);
                hoverLine.setAttribute('y2', viewBox.height - padding.bottom);
                hoverLine.style.display = 'block';
            }
        }
    });

    container.addEventListener('mouseout', (event) => {
        const related = event.relatedTarget;
        if (related && related.closest && related.closest('.chart-point')) return;
        const svg = container.querySelector('svg');
        if (svg) {
            const hoverLine = svg.querySelector('.chart-hover-line');
            if (hoverLine) hoverLine.style.display = 'none';
        }
        tooltip.style.display = 'none';
    });
}

// ===== Работа с датами =====

/**
 * Все данные дашборда берутся ТОЛЬКО из JSON-отчётов папки "!АРХИВ":
 * index — номер отчёта в archivePoints (отсортированы по дате из имени файла).
 * Точки "Сейчас" нет — XML-файлы сайт не читает (кроме выгрузки отчёта).
 */
function getDataForDate(index) {
    const point = archivePoints[index];
    if (!point) return null;
    const filtered = getFilteredArchivePoint(point);
    return {
        records: sectionsToClashRecords(filtered.sections),
        total: filtered.total,
        sections: filtered.sections,
        pairs: filtered.pairs,
        guidEntries: filtered.guidEntries || [],
        files: filterRecordsByDiscipline(point.files || []),
    };
}

function rebuildDateDropdowns() {
    const options = archivePoints.map((p, i) => ({ label: p.key, value: i }));

    startDateList.innerHTML = '';
    options.forEach(opt => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-dropdown__item';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        if (opt.value === startDateIndex) btn.classList.add('folder-dropdown__item--active');
        btn.addEventListener('click', () => {
            selectStartDate(opt.value);
        });
        li.appendChild(btn);
        startDateList.appendChild(li);
    });

    endDateList.innerHTML = '';
    options.forEach(opt => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-dropdown__item';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        if (opt.value === endDateIndex) btn.classList.add('folder-dropdown__item--active');
        btn.addEventListener('click', () => {
            selectEndDate(opt.value);
        });
        li.appendChild(btn);
        endDateList.appendChild(li);
    });

    updateDateDropdownOptions();
    updateDateLabels();
}

function updateDateDropdownOptions() {
    const startItems = startDateList.querySelectorAll('.folder-dropdown__item');
    startItems.forEach(btn => {
        const val = parseInt(btn.dataset.value);
        // начальная дата не может быть позже конечной
        const enabled = val <= endDateIndex;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.4';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });

    const endItems = endDateList.querySelectorAll('.folder-dropdown__item');
    endItems.forEach(btn => {
        const val = parseInt(btn.dataset.value);
        // конечная дата не может быть раньше начальной
        const enabled = val >= startDateIndex;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '1' : '0.4';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
    });
}

function updateDateLabels() {
    startDateLabel.textContent = archivePoints[startDateIndex] ? archivePoints[startDateIndex].key : '-';
    endDateLabel.textContent = archivePoints[endDateIndex] ? archivePoints[endDateIndex].key : '-';
}

function selectStartDate(value) {
    startDateIndex = value;
    startDateList.querySelectorAll('.folder-dropdown__item').forEach(btn => {
        btn.classList.toggle('folder-dropdown__item--active', parseInt(btn.dataset.value) === value);
    });
    startDateList.classList.remove('folder-dropdown__list--open');
    startDateToggle.setAttribute('aria-expanded', 'false');
    updateDateDropdownOptions();
    updateDateLabels();
    updateDashboard();
}

function selectEndDate(value) {
    endDateIndex = value;
    endDateList.querySelectorAll('.folder-dropdown__item').forEach(btn => {
        btn.classList.toggle('folder-dropdown__item--active', parseInt(btn.dataset.value) === value);
    });
    endDateList.classList.remove('folder-dropdown__list--open');
    endDateToggle.setAttribute('aria-expanded', 'false');
    updateDateDropdownOptions();
    updateDateLabels();
    updateDashboard();
}

function setDefaultDates() {
    // по умолчанию: предпоследний отчёт -> последний (если отчёт один — он же
    // и начальная, и конечная дата; если отчётов нет — оба индекса -1)
    endDateIndex = archivePoints.length - 1;
    startDateIndex = Math.max(endDateIndex - 1, Math.min(endDateIndex, 0));
    rebuildDateDropdowns();
    updateDateDropdownOptions();
    updateDateLabels();
}

// ===== Главная функция обновления дашборда =====

function updateDashboard() {
    if (activeFolderIndex === -1) {
        totalCollisionsValue.textContent = '—';
        changePercentValue.textContent = '—';
        periodDeltaValue.textContent = '—';
        renderComparisonStats(null, null);
        collisionMatrixBody.innerHTML = '';
        sectionTableBody.innerHTML = '';
        totalChartBody.innerHTML = '';
        disciplineChartBody.innerHTML = '';
        updateZoomButtonVisibility();
        return;
    }

    const startData = getDataForDate(startDateIndex);
    const endData = getDataForDate(endDateIndex);
    // "всего" и процент — всегда по ПОСЛЕДНЕМУ отчёту в "!АРХИВ" (последний
    // по дате в имени файла), независимо от выбранной конечной даты
    const latestData = getDataForDate(archivePoints.length - 1);
    if (!startData || !endData || !latestData) {
        totalCollisionsValue.textContent = '—';
        changePercentValue.textContent = '—';
        periodDeltaValue.textContent = '—';
        renderComparisonStats(null, null);
        collisionMatrixBody.innerHTML = '';
        sectionTableBody.innerHTML = '';
        totalChartBody.innerHTML = '';
        disciplineChartBody.innerHTML = '';
        updateZoomButtonVisibility();
        return;
    }

    const totalCurrent = latestData.total;
    totalCollisionsValue.textContent = totalCurrent;

    const startTotal = startData.total;
    let localChangePercent;
    if (startTotal === 0) {
        localChangePercent = totalCurrent === 0 ? 0 : 100;
    } else {
        localChangePercent = Math.round(((totalCurrent - startTotal) / startTotal) * 100);
    }
    changePercentValue.textContent = localChangePercent > 0 ? `+${localChangePercent}%` : `${localChangePercent}%`;
    setColor(changePercentValue, localChangePercent);

    const delta = endData.total - startData.total;
    periodDeltaValue.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    setColor(periodDeltaValue, delta);

    renderComparisonStats(startData, endData);

    const visiblePoints = archivePoints.map(getFilteredArchivePoint);
    const startIdx = startDateIndex;
    const endIdx = endDateIndex;

    renderCollisionMatrix(endData.pairs, startData.pairs);
    renderSectionTable(endData.records, startData, endData.files);

    const allPoints = visiblePoints;
    function applyZoom(points, selectedStartIdx, selectedEndIdx, zoom) {
        const total = points.length;
        let start = zoom.start;
        let end = (zoom.end !== null) ? zoom.end : total - 1;
        if (zoom.end === null || (start === 0 && end === total - 1)) {
            return { points, startIdx: selectedStartIdx, endIdx: selectedEndIdx };
        }
        const visiblePoints = points.slice(start, end + 1);
        const offset = start;
        const newStartIdx = (selectedStartIdx >= start && selectedStartIdx <= end) ? selectedStartIdx - offset : -1;
        const newEndIdx = (selectedEndIdx >= start && selectedEndIdx <= end) ? selectedEndIdx - offset : -1;
        return { points: visiblePoints, startIdx: newStartIdx, endIdx: newEndIdx };
    }

    const totalZoomed = applyZoom(allPoints, startIdx, endIdx, zoomState.total);
    const disciplineZoomed = applyZoom(allPoints, startIdx, endIdx, zoomState.discipline);

    renderTotalChart(totalZoomed.points, totalZoomed.startIdx, totalZoomed.endIdx);
    renderDisciplineChart(disciplineZoomed.points, disciplineZoomed.startIdx, disciplineZoomed.endIdx);

    updateZoomButtonVisibility();
}

// ===== Управление списком папок =====

/**
 * Папка добавляется только по JSON-отчётам из "!АРХИВ" — XML-файлы здесь не
 * читаются вовсе (их читает только exportReport в момент выгрузки отчёта).
 */
function addFolder(name, allFiles, dirHandle = null) {
    return buildArchivePoints(allFiles, name).then((points) => {
        // без отчётов показывать нечего; в административной версии папку всё
        // равно добавляем — чтобы можно было выгрузить первый отчёт
        if (!points.length && !(canWriteFiles && dirHandle)) {
            alert(`В папке "${name}" не найдена подпапка "${ARCHIVE_FOLDER_NAME}" с отчётами вида "${name}_дд-мм-гггг.json".`);
            return;
        }
        const folder = { name, archivePoints: points, dirHandle };
        const existingIndex = folders.findIndex(f => f.name === name);
        if (existingIndex === -1) folders.push(folder);
        else folders[existingIndex] = folder;
        folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        rebuildFolderDropdown();
        setActiveFolder(folders.findIndex(f => f.name === name));
    });
}

function rebuildFolderDropdown() {
    folderDropdown.hidden = folders.length === 0;
    folderDropdownList.innerHTML = folders.map((f, i) => `
        <li><button type="button" class="folder-dropdown__item${i === activeFolderIndex ? ' folder-dropdown__item--active' : ''}" data-index="${i}">${f.name}</button></li>
    `).join('');
    folderDropdownList.querySelectorAll('.folder-dropdown__item').forEach(item => {
        item.addEventListener('click', () => {
            setActiveFolder(Number(item.dataset.index));
            closeFolderDropdown();
        });
    });
}

function closeFolderDropdown() {
    folderDropdownList.classList.remove('folder-dropdown__list--open');
    folderDropdownToggle.setAttribute('aria-expanded', 'false');
}

function setActiveFolder(index) {
    zoomState.total.end = null;
    zoomState.discipline.end = null;

    const folder = folders[index];
    if (!folder) return;
    activeFolderIndex = index;
    folderDropdownLabel.textContent = folder.name;
    rebuildFolderDropdown();
    pinnedDisciplines = new Set();
    expandedSections = new Set();
    archivePoints = folder.archivePoints;

    const allRecordsForFilters = folder.archivePoints.flatMap(p => sectionsToClashRecords(p.sections));
    const disciplinesForFilters = getPresentDisciplines(allRecordsForFilters);
    rebuildDisciplineFilters(disciplinesForFilters);

    setDefaultDates();
    updateDashboard();
    updateExportButtonState();
    updatePdfButtonState();
}

function resetDashboard() {
    zoomState.total.end = null;
    zoomState.discipline.end = null;

    folders = [];
    activeFolderIndex = -1;
    archivePoints = [];
    pinnedDisciplines = new Set();
    expandedSections = new Set();
    disciplineFilterList.innerHTML = '';
    disciplineFilter = new Set();
    totalCollisions = 'N';
    changePercent = 0;
    startDateIndex = -1;
    endDateIndex = -1;

    folderDropdown.hidden = true;
    folderDropdownList.innerHTML = '';
    folderDropdownLabel.textContent = 'Папка не выбрана';
    closeFolderDropdown();

    totalCollisionsValue.textContent = totalCollisions;
    changePercentValue.textContent = '—';
    setColor(changePercentValue, 0);
    periodDeltaValue.textContent = '—';

    collisionMatrixBody.innerHTML = '';
    sectionTableBody.innerHTML = '';
    totalChartBody.innerHTML = '';
    disciplineChartBody.innerHTML = '';

    startDateList.innerHTML = '';
    endDateList.innerHTML = '';
    startDateLabel.textContent = '-';
    endDateLabel.textContent = '-';

    renderComparisonStats(null, null);
    updateExportButtonState();
    updatePdfButtonState();
    updateZoomButtonVisibility();
}

// ===== Выбор папки через File System Access API =====

/**
 * Выбор папки через системный диалог (Chrome/Edge, https или localhost).
 * В отличие от <input webkitdirectory>, браузер НЕ перечисляет заранее все
 * файлы папки (и не показывает "будет загружено N файлов") — код сам читает
 * только нужное, см. collectFilesFromDirectoryHandle.
 */
async function pickFolderWithDirectoryPicker() {
    let dirHandle;
    try { dirHandle = await window.showDirectoryPicker(); } catch (e) { return; }
    const files = [];
    await collectFilesFromDirectoryHandle(dirHandle, '', files);
    addFolder(dirHandle.name, files, dirHandle);
}

/**
 * Читает ТОЛЬКО .json из подпапки "!АРХИВ" выбранной папки: папка ищется по
 * имени напрямую (без перебора содержимого), остальные файлы и вложенные
 * папки не затрагиваются вовсе.
 */
async function collectFilesFromDirectoryHandle(dirHandle, prefix, results) {
    let archiveHandle;
    try {
        archiveHandle = await dirHandle.getDirectoryHandle(ARCHIVE_FOLDER_NAME);
    } catch (e) {
        return; // папки "!АРХИВ" нет
    }
    const path = `${dirHandle.name}/${ARCHIVE_FOLDER_NAME}`;
    for await (const [name, handle] of archiveHandle.entries()) {
        if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
        const file = await handle.getFile();
        Object.defineProperty(file, 'webkitRelativePath', { value: `${path}/${name}`, configurable: true });
        results.push(file);
    }
}

/**
 * .xml верхнего уровня папки — читаются только в момент выгрузки отчёта
 */
async function collectXmlFilesFromDirectoryHandle(dirHandle) {
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'file' && name.toLowerCase().endsWith('.xml')) {
            files.push(await handle.getFile());
        }
    }
    return files;
}

// ===== Drag & Drop =====

async function handleDroppedItems(dataTransferItems) {
    const pending = Array.from(dataTransferItems)
        .filter(item => item.kind === 'file')
        .map(item => ({
            handlePromise: (canWriteFiles && typeof item.getAsFileSystemHandle === 'function') ? item.getAsFileSystemHandle() : null,
            entry: item.webkitGetAsEntry && item.webkitGetAsEntry(),
        }));

    for (const { handlePromise, entry } of pending) {
        if (handlePromise) {
            const handle = await handlePromise;
            if (handle && handle.kind === 'directory') {
                await addDroppedDirectoryHandle(handle);
                continue;
            }
        }
        if (!entry || !entry.isDirectory) continue;
        const files = [];
        await collectFilesFromEntry(entry, '', files);
        await addFolder(entry.name, files);
    }
}

async function addDroppedDirectoryHandle(dirHandle) {
    let canWrite = false;
    try {
        const granted = await dirHandle.queryPermission({ mode: 'readwrite' });
        canWrite = granted === 'granted' || (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) { canWrite = false; }
    const files = [];
    await collectFilesFromDirectoryHandle(dirHandle, '', files);
    await addFolder(dirHandle.name, files, canWrite ? dirHandle : null);
}

/**
 * То же ограничение, что и в collectFilesFromDirectoryHandle: depth 0 — сама
 * перетащенная папка, depth 1 — её содержимое (заходим только в "!АРХИВ",
 * файлы не трогаем), depth 2 — содержимое "!АРХИВ" (только .json)
 */
async function collectFilesFromEntry(entry, prefix, results, depth = 0) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const lowerName = entry.name.toLowerCase();
    if (entry.isFile) {
        const isWanted = depth === 2 && lowerName.endsWith('.json');
        if (!isWanted) return;
        const file = await readEntryAsFile(entry);
        Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true });
        results.push(file);
        return;
    }
    if (entry.isDirectory) {
        const isWanted = depth === 0 || (depth === 1 && entry.name === ARCHIVE_FOLDER_NAME);
        if (!isWanted) return;
        const children = await readAllDirectoryEntries(entry);
        for (const child of children) await collectFilesFromEntry(child, path, results, depth + 1);
    }
}

async function readAllDirectoryEntries(dirEntry) {
    const reader = dirEntry.createReader();
    let allEntries = [], batch;
    do {
        batch = await readDirectoryEntries(reader);
        allEntries = allEntries.concat(batch);
    } while (batch.length > 0);
    return allEntries;
}

function readDirectoryEntries(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function readEntryAsFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
}

// ===== Выгрузка отчёта =====

function updateExportButtonState() {
    if (!btnExportReport || !canWriteFiles) return;
    const folder = folders[activeFolderIndex];
    const canExport = Boolean(folder && folder.dirHandle);
    btnExportReport.disabled = !canExport;
    btnExportReport.title = canExport ? '' : 'Выберите папку с XML-отчётами';
}

async function exportReport() {
    const folder = folders[activeFolderIndex];
    if (!folder || !folder.dirHandle) {
        alert('Нет доступа на запись для этой папки — выберите её заново кнопкой "Выбрать папку с XML-отчётами".');
        return;
    }
    // XML-файлы читаются только здесь, в момент выгрузки: дашборд строится
    // исключительно по JSON-отчётам из "!АРХИВ"
    btnExportReport.disabled = true;
    btnExportReport.textContent = 'Чтение XML...';
    let records;
    try {
        const xmlFiles = await collectXmlFilesFromDirectoryHandle(folder.dirHandle);
        if (!xmlFiles.length) {
            alert('В выбранной папке не найдено ни одного .xml-файла верхнего уровня (только в самой папке, не во вложенных).');
            btnExportReport.textContent = 'Выгрузить отчёт';
            updateExportButtonState();
            return;
        }
        records = await buildClashRecords(xmlFiles);
    } catch (error) {
        console.error('Не удалось прочитать XML-файлы:', error);
        alert('Не удалось прочитать XML-файлы — подробности в консоли (F12).');
        btnExportReport.textContent = 'Выгрузить отчёт';
        updateExportButtonState();
        return;
    }
    const total = records.reduce((sum, record) => sum + record.total, 0);

    const disciplines = getPresentDisciplines(records);
    const sections = {};
    disciplines.forEach(d => { sections[d] = getDisciplineTotal(records, d); });
    const matrix = buildCollisionMatrix(records, disciplines);
    const pairs = {};
    disciplines.forEach((row, ri) => {
        disciplines.forEach((col, ci) => {
            if (ci < ri) return;
            pairs[getPairKey(row, col)] = matrix[row][col];
        });
    });
    const guids = getGuidEntries(records);
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const fileName = `${folder.name}_${day}-${month}-${year}.json`;
    // список файлов — для раскрывающихся строк "Таблицы по разделам" на архивных датах
    const files = records.map((record) => ({
        fileName: record.fileName,
        discipline1: record.discipline1,
        discipline2: record.discipline2,
        total: record.total,
    }));
    const reportData = { total, sections, pairs, guids, files };

    btnExportReport.disabled = true;
    btnExportReport.textContent = 'Сохранение...';
    try {
        const archiveDirHandle = await folder.dirHandle.getDirectoryHandle(ARCHIVE_FOLDER_NAME, { create: true });
        const fileHandle = await archiveDirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(reportData, null, 2));
        await writable.close();
        const refreshedFiles = [];
        await collectFilesFromDirectoryHandle(folder.dirHandle, '', refreshedFiles);
        await addFolder(folder.name, refreshedFiles, folder.dirHandle);
    } catch (error) {
        console.error('Не удалось сохранить отчёт:', error);
        alert('Не удалось сохранить отчёт — подробности в консоли (F12).');
    } finally {
        btnExportReport.textContent = 'Выгрузить отчёт';
        updateExportButtonState();
    }
}

// ===== Выгрузка в PDF =====

/**
 * Кнопка активна, только когда выбрана папка
 */
function updatePdfButtonState() {
    if (!btnExportPdf) return;
    const hasFolder = Boolean(folders[activeFolderIndex]);
    btnExportPdf.disabled = !hasFolder;
    btnExportPdf.title = hasFolder ? '' : 'Выберите папку с XML-отчётами';
}

/**
 * Шапка PDF — собирается из текущих значений сайдбара (вставляется только в
 * копию страницы, которую рисует html2canvas, на сам сайт не влияет)
 */
function buildPdfHeader(targetDocument, folder) {
    const today = new Date();
    const dateText = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    const checkedDisciplines = Array.from(disciplineFilterList.querySelectorAll('.discipline-filter__checkbox'))
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
    const allDisciplinesCount = disciplineFilterList.querySelectorAll('.discipline-filter__checkbox').length;
    const filterText = checkedDisciplines.length === allDisciplinesCount ? 'все разделы' : (checkedDisciplines.join(', ') || '—');

    const header = targetDocument.createElement('div');
    header.className = 'pdf-header';
    header.innerHTML = `
        <div class="pdf-header__title">Отчёт по коллизиям — ${escapeHtml(folder.name)}</div>
        <div class="pdf-header__line">Дата формирования: ${dateText} · Период: ${escapeHtml(startDateLabel.textContent)} — ${escapeHtml(endDateLabel.textContent)} · Фильтр: ${escapeHtml(filterText)}</div>
        <div class="pdf-header__line">
            Всего: <b>${escapeHtml(totalCollisionsValue.textContent)}</b> ·
            Изменение: <b>${escapeHtml(changePercentValue.textContent)}</b> ·
            За период: <b>${escapeHtml(periodDeltaValue.textContent)}</b> ·
            Активные: <b>${escapeHtml(document.getElementById('active').textContent)}</b> ·
            Новые: <b>${escapeHtml(document.getElementById('new').textContent)}</b> ·
            Решённые: <b>${escapeHtml(document.getElementById('resolved').textContent)}</b>
        </div>
    `;
    return header;
}

/**
 * html2canvas рисует <svg> через сериализацию, и правила из style.css внутрь
 * SVG не попадают (линии графиков заливались бы чёрным) — поэтому переносим
 * вычисленные стили в атрибут style каждого элемента SVG в копии страницы
 */
function inlineSvgStyles(targetDocument) {
    const view = targetDocument.defaultView;
    const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'stroke-linecap',
        'opacity', 'display', 'font-family', 'font-size', 'font-weight'];
    targetDocument.querySelectorAll('svg, svg *').forEach((element) => {
        const computed = view.getComputedStyle(element);
        properties.forEach((property) => {
            element.style.setProperty(property, computed.getPropertyValue(property));
        });
    });
}

async function exportPdf() {
    const folder = folders[activeFolderIndex];
    if (!folder) return;
    if (typeof window.html2canvas !== 'function' || !window.jspdf) {
        alert('Не удалось загрузить библиотеки для PDF — проверьте подключение к интернету и обновите страницу.');
        return;
    }

    hideChartTooltip();
    btnExportPdf.disabled = true;
    btnExportPdf.textContent = 'Формирование PDF...';
    try {
        const content = document.querySelector('.content');
        const canvas = await window.html2canvas(content, {
            scale: 2,
            backgroundColor: getComputedStyle(document.querySelector('.main-conteiner')).backgroundColor,
            ignoreElements: (element) => element.classList && element.classList.contains('btn-zoom-last-five'),
            onclone: (clonedDocument) => {
                const clonedContent = clonedDocument.querySelector('.content');
                // шапка — отдельной строкой сетки над плитками, высоты плиток не меняются
                clonedContent.style.gridTemplateRows = 'auto 35vh 60vh 40vh';
                clonedContent.style.gridTemplateAreas = '"pdf-header pdf-header" "total-chart total-chart" "collision-matrix section-table" "discipline-chart discipline-chart"';
                clonedContent.insertBefore(buildPdfHeader(clonedDocument, folder), clonedContent.firstChild);
                inlineSvgStyles(clonedDocument);
            },
        });

        // одна страница шириной A4 (297 мм), высота — по пропорциям снимка,
        // чтобы плитки не разрезались между страницами
        const pageWidth = 297;
        const pageHeight = canvas.height * pageWidth / canvas.width;
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [pageWidth, pageHeight],
        });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWidth, pageHeight);

        const today = new Date();
        const dateKey = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        pdf.save(`${folder.name}_${dateKey}.pdf`);
    } catch (error) {
        console.error('Не удалось сформировать PDF:', error);
        alert('Не удалось сформировать PDF — подробности в консоли (F12).');
    } finally {
        btnExportPdf.textContent = 'Выгрузить в PDF';
        updatePdfButtonState();
    }
}

// ===== Кнопка "Приблизить последние пять" =====

function addZoomToLastFiveButton() {
    const totalChartCard = document.querySelector('.card:has(#total-chart-body)');
    if (!totalChartCard) return;
    const title = totalChartCard.querySelector('.card__title');
    if (!title) return;
    if (title.querySelector('.btn-zoom-last-five')) return;
    const btn = document.createElement('button');
    btn.className = 'btn-zoom-last-five';
    btn.textContent = 'Приблизить последние пять';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const totalPoints = archivePoints.length;
        if (totalPoints <= 1) return;
        const maxPointsToShow = Math.min(totalPoints, 5);
        const start = totalPoints - maxPointsToShow;
        const end = totalPoints - 1;
        zoomState.total.start = start;
        zoomState.total.end = end;
        zoomState.discipline.start = start;
        zoomState.discipline.end = end;
        updateDashboard();
    });
    title.appendChild(btn);
    updateZoomButtonVisibility();
}

function updateZoomButtonVisibility() {
    const btn = document.querySelector('.btn-zoom-last-five');
    if (!btn) return;
    const totalPoints = archivePoints.length;
    if (totalPoints > 1) {
        btn.style.display = 'inline-block';
    } else {
        btn.style.display = 'none';
    }
}

// ===== Обработчики событий =====

btnSelectFolder.addEventListener('click', () => {
    // системный диалог выбора папки — в обеих версиях страницы, где он
    // доступен; <input webkitdirectory> — запасной вариант (file://, Firefox),
    // там браузер сам перечисляет ВСЕ файлы папки, включая вложенные
    if (supportsDirectoryPicker && isSecureLocalContext) pickFolderWithDirectoryPicker();
    else xmlFileInput.click();
});

xmlFileInput.addEventListener('change', () => {
    const allFiles = Array.from(xmlFileInput.files);
    xmlFileInput.value = '';
    if (!allFiles.length) return;
    const folderName = (allFiles[0].webkitRelativePath || allFiles[0].name).split('/')[0];
    addFolder(folderName, allFiles);
});

btnClearFolders.addEventListener('click', resetDashboard);

disciplineFilterList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.discipline-filter__checkbox');
    if (!checkbox) return;
    if (checkbox.checked) disciplineFilter.add(checkbox.value);
    else disciplineFilter.delete(checkbox.value);
    updateDashboard();
});

folderDropdownToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = folderDropdownList.classList.toggle('folder-dropdown__list--open');
    folderDropdownToggle.setAttribute('aria-expanded', String(isOpen));
});

startDateToggle.addEventListener('click', () => {
    const isOpen = startDateList.classList.toggle('folder-dropdown__list--open');
    startDateToggle.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
        endDateList.classList.remove('folder-dropdown__list--open');
        endDateToggle.setAttribute('aria-expanded', 'false');
    }
});

endDateToggle.addEventListener('click', () => {
    const isOpen = endDateList.classList.toggle('folder-dropdown__list--open');
    endDateToggle.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
        startDateList.classList.remove('folder-dropdown__list--open');
        startDateToggle.setAttribute('aria-expanded', 'false');
    }
});

document.addEventListener('click', (event) => {
    if (!startDateDropdown.contains(event.target)) {
        startDateList.classList.remove('folder-dropdown__list--open');
        startDateToggle.setAttribute('aria-expanded', 'false');
    }
    if (!endDateDropdown.contains(event.target)) {
        endDateList.classList.remove('folder-dropdown__list--open');
        endDateToggle.setAttribute('aria-expanded', 'false');
    }
    if (!folderDropdown.contains(event.target)) {
        closeFolderDropdown();
    }
});

if (btnExportReport) {
    if (canWriteFiles) btnExportReport.addEventListener('click', exportReport);
    else btnExportReport.disabled = true;
}

if (btnExportPdf) btnExportPdf.addEventListener('click', exportPdf);

document.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    dragEnterCounter++;
    document.body.classList.add('dragging-folders');
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('dragleave', () => {
    dragEnterCounter = Math.max(0, dragEnterCounter - 1);
    if (dragEnterCounter === 0) document.body.classList.remove('dragging-folders');
});
document.addEventListener('drop', (event) => {
    event.preventDefault();
    dragEnterCounter = 0;
    document.body.classList.remove('dragging-folders');
    handleDroppedItems(event.dataTransfer.items);
});

// ===== Фильтр разделов =====

function rebuildDisciplineFilters(disciplines) {
    disciplineFilterList.innerHTML = '';
    // Сортируем по алфавиту
    const sortedDisciplines = disciplines.slice().sort((a, b) => a.localeCompare(b));
    const newFilter = new Set();
    sortedDisciplines.forEach(d => { if (KNOWN_DISCIPLINES.includes(d)) newFilter.add(d); });
    disciplineFilter = newFilter;
    sortedDisciplines.forEach(d => {
        if (KNOWN_DISCIPLINES.includes(d)) newFilter.add(d);
    });
    disciplineFilter = newFilter;

    sortedDisciplines.forEach(d => {
        if (!KNOWN_DISCIPLINES.includes(d)) return;
        const label = document.createElement('label');
        label.className = 'discipline-filter__item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'discipline-filter__checkbox';
        checkbox.value = d;
        checkbox.checked = true;
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(d));
        disciplineFilterList.appendChild(label);
    });
}

function getFilteredGuidEntriesFromPoint(data) {
    if (!data) return [];
    const entries = data.guidEntries || [];
    return filterGuidEntriesByDiscipline(entries);
}

// ===== Зум (Ctrl+колесо) =====

let zoomState = {
    total: { start: 0, end: null },
    discipline: { start: 0, end: null }
};

document.addEventListener('wheel', function(event) {
    if (!event.ctrlKey) return;

    const totalContainer = document.getElementById('total-chart-body');
    const disciplineContainer = document.getElementById('discipline-chart-body');
    let target = event.target;
    let graphType = null;

    if (totalContainer.contains(target)) graphType = 'total';
    else if (disciplineContainer.contains(target)) graphType = 'discipline';
    else return;

    event.preventDefault();

    const svg = target.closest('svg');
    if (!svg) return;

    const totalPoints = archivePoints.length;
    if (totalPoints <= 1) return;

    const rect = svg.getBoundingClientRect();
    const paddingLeft = 20;
    const paddingRight = 20;
    const chartWidth = rect.width - paddingLeft - paddingRight;
    if (chartWidth <= 0) return;

    const mouseX = event.clientX - rect.left - paddingLeft;
    const fraction = Math.max(0, Math.min(1, mouseX / chartWidth));
    const pointIndex = Math.round(fraction * (totalPoints - 1));
    const clamped = Math.max(0, Math.min(totalPoints - 1, pointIndex));

    const zoom = zoomState[graphType];
    const currentStart = zoom.start;
    const currentEnd = (zoom.end !== null) ? zoom.end : totalPoints - 1;
    const currentRange = currentEnd - currentStart + 1;

    const delta = event.deltaY;
    let newStart = currentStart;
    let newEnd = currentEnd;

    if (delta > 0) {
        const newRange = Math.max(2, Math.floor(currentRange / 1.5));
        let half = Math.floor(newRange / 2);
        newStart = Math.max(0, Math.min(clamped - half, totalPoints - newRange));
        newEnd = newStart + newRange - 1;
        if (newEnd >= totalPoints) {
            newEnd = totalPoints - 1;
            newStart = newEnd - newRange + 1;
        }
    } else {
        const newRange = Math.min(totalPoints, Math.floor(currentRange * 1.5));
        let half = Math.floor(newRange / 2);
        const center = (currentStart + currentEnd) / 2;
        newStart = Math.max(0, Math.floor(center - half));
        newEnd = newStart + newRange - 1;
        if (newEnd >= totalPoints) {
            newEnd = totalPoints - 1;
            newStart = newEnd - newRange + 1;
        }
    }

    if (newStart === 0 && newEnd === totalPoints - 1) {
        zoom.end = null;
    } else {
        zoom.start = newStart;
        zoom.end = newEnd;
    }

    updateDashboard();
}, { passive: false });

document.addEventListener('dblclick', function(event) {
    const totalContainer = document.getElementById('total-chart-body');
    const disciplineContainer = document.getElementById('discipline-chart-body');

    if (totalContainer.contains(event.target) || disciplineContainer.contains(event.target)) {
        zoomState.total.end = null;
        zoomState.discipline.end = null;
        updateDashboard();
    }
});

// ===== Инициализация =====

addZoomToLastFiveButton();
setupTotalChartInteractions();
setupDisciplineChartInteractions();
setupSectionTableInteractions();
resetDashboard();