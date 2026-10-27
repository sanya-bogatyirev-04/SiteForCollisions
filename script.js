// ===== Константы =====

/**
 * Известные коды разделов проекта — только они попадают в фильтр разделов
 */
const KNOWN_DISCIPLINES = ["АР", "КР", "ВК", "ЭОМ", "ВиК", "ОТМ", "СС", "АПТ-ВПВ", "КЖ", "АУПТ", "ИТП"];

/**
 * Подставляется вместо раздела, если в отчёте он не указан
 */
const NOT_DEFINED = "Не опр.";

/**
 * Название папки с архивом. Пользователь выбирает одну папку (обычно
 * "03-Проверки"); в каждой её НЕПОСРЕДСТВЕННОЙ подпапке лежит "!АРХИВ", а в
 * нём — ПЛОСКО, без вложенных папок по датам — JSON-отчёты вида
 * "<имя подпапки>_дд-мм-гггг.json" (их выгружает отдельный exe).
 */
const ARCHIVE_FOLDER_NAME = '!АРХИВ';

/**
 * Имя файла архивного отчёта: "<имя папки>_дд-мм-гггг.json"
 */
const REPORT_FILE_NAME_RE = /^(.+)_(\d{2})-(\d{2})-(\d{4})\.json$/i;

/**
 * Отступы области построения графиков (в единицах viewBox) — общие для обоих
 * графиков и для расчёта точки под курсором при зуме
 */
// left — место под числа оси Y (шрифт чисел 20px на экране, см. fitChartTextToScreen)
const CHART_PADDING = { top: 16, right: 20, bottom: 45, left: 60 };

/**
 * Подписи дат под осью X: первая — от точки вправо, последняя — от точки
 * влево, остальные — по центру; иначе крайние даты обрезаются краем графика
 */
function getDateLabelAnchor(index, count) {
    if (count > 1 && index === 0) return 'start';
    if (count > 1 && index === count - 1) return 'end';
    return 'middle';
}

/**
 * На каком расстоянии от точки графика (в экранных пикселях) уже показывается
 * подсказка
 */
const TOOLTIP_HIT_RADIUS = 15;

// ===== Элементы страницы =====

const totalCollisionsValue = document.getElementById('total-collisions-value');
const changePercentValue = document.getElementById('change-percent-value');
const periodDeltaValue = document.getElementById('period-delta-value');

const projectNameTitle = document.getElementById('project-name');
const folderInput = document.getElementById('folder-input');
const btnSelectFolder = document.getElementById('btn-select-folder');
const folderFilter = document.getElementById('folder-filter');
const folderFilterToggle = document.getElementById('folder-filter-toggle');
const folderFilterLabel = document.getElementById('folder-filter-label');
const folderFilterPanel = document.getElementById('folder-filter-panel');
const folderFilterAll = document.getElementById('folder-filter-all');
const folderFilterOptions = document.getElementById('folder-filter-options');

const startDateDropdown = document.getElementById('start-date-dropdown');
const startDateToggle = document.getElementById('start-date-toggle');
const startDateLabel = document.getElementById('start-date-label');
const startDateList = document.getElementById('start-date-list');

const endDateDropdown = document.getElementById('end-date-dropdown');
const endDateToggle = document.getElementById('end-date-toggle');
const endDateLabel = document.getElementById('end-date-label');
const endDateList = document.getElementById('end-date-list');

const btnExportPdf = document.getElementById('btn-export-pdf');

const collisionMatrixBody = document.getElementById('collision-matrix-body');
const sectionTableBody = document.getElementById('section-table-body');
const totalChartBody = document.getElementById('total-chart-body');
const disciplineChartBody = document.getElementById('discipline-chart-body');

const disciplineFilterList = document.getElementById('discipline-filter-list');

// ===== Состояние =====

let folders = [];                  // загруженные подпапки: { name, archivePoints }
let selectedFolderNames = new Set(); // подпапки, отмеченные в фильтре папок
let archivePoints = [];            // сумма отчётов выбранных подпапок по датам (см. buildAggregatedPoints)
let pinnedDisciplines = new Set();
let expandedSections = new Set(); // разделы, раскрытые в "Таблице по разделам"
let disciplineFilter = new Set();
let startDateIndex = -1;
let endDateIndex = -1;
let totalCollisions = 'N';
let changePercent = 0;
let dragEnterCounter = 0;
let chartTooltip = null;

// видимый диапазон точек графиков (Ctrl+колесо); end === null — без зума.
// Объявлено здесь, вместе с остальным состоянием, а не рядом с обработчиком
// колеса: resetDashboard/applyFolderSelection обращаются к нему раньше, и
// при объявлении ниже любая ошибка между ними давала "Cannot access
// 'zoomState' before initialization"
let zoomState = {
    total: { start: 0, end: null },
    discipline: { start: 0, end: null }
};

/**
 * Системный диалог выбора папки (Chrome/Edge). Страница, открытая через
 * file://, в этих браузерах тоже считается secure context.
 */
const canUseDirectoryPicker = window.isSecureContext && typeof window.showDirectoryPicker === 'function';

/**
 * Название проекта = имя html-файла без расширения: html/css/js копируют в
 * папку проекта и переименовывают html-файл
 */
const projectName = getProjectName();

function getProjectName() {
    try {
        const lastSegment = decodeURIComponent(location.pathname.split('/').pop() || '');
        const name = lastSegment.replace(/\.html?$/i, '').trim();
        if (name) return name;
    } catch (e) {
        // некорректная %-последовательность в адресе — берём заголовок страницы
    }
    return document.title;
}

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

/**
 * GUID сравниваются вместе с именем подпапки: при выборе нескольких папок
 * одинаковые GUID из разных папок — это разные коллизии
 */
function getGuidKey(entry) {
    return `${entry.folderName}|${entry.guid}`;
}

function computeComparisonStats(startData, endData) {
    if (!startData || !endData) return null;
    if (!startData.guidEntries || !startData.guidEntries.length) return null;
    if (!endData.guidEntries || !endData.guidEntries.length) return null;

    const startGuids = new Set(getFilteredGuidEntriesFromPoint(startData).map(getGuidKey));
    const endGuids = new Set(getFilteredGuidEntriesFromPoint(endData).map(getGuidKey));

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

// ===== Чтение отчётов выбранной папки =====

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

/**
 * Отчёт подпапки: путь "<выбранная папка>/<подпапка>/!АРХИВ/<файл>.json" —
 * ровно 4 сегмента, имя файла "<имя этой подпапки>_дд-мм-гггг.json"
 */
function isArchiveReportFile(file) {
    if (!file.name.toLowerCase().endsWith('.json')) return false;
    const segments = (file.webkitRelativePath || '').split('/');
    if (segments.length !== 4) return false;
    if (segments[2] !== ARCHIVE_FOLDER_NAME) return false;
    const parsed = parseReportFileName(file.name);
    return Boolean(parsed) && parsed.folderNamePart === segments[1];
}

/**
 * Имя подпапки, к которой относится отчёт (второй сегмент пути)
 */
function getReportFolderName(file) {
    return file.webkitRelativePath.split('/')[1];
}

/**
 * reportFiles — уже отобранные отчёты одной подпапки (см. isArchiveReportFile).
 * У каждого GUID и файла запоминается имя подпапки — для сравнения и
 * подписей при выборе нескольких папок.
 */
function buildArchivePoints(reportFiles, folderName) {
    return Promise.all(
        reportFiles.map((file) =>
            file.text().then((text) => {
                let data;
                try { data = JSON.parse(text); } catch (e) { console.error(`Не удалось разобрать отчёт ${file.name}:`, e); return null; }
                if (!data || typeof data !== 'object') return null;
                const parsed = parseReportFileName(file.name);
                const guidEntries = Array.isArray(data.guids)
                    ? data.guids
                        .filter((entry) => entry && typeof entry.guid === 'string')
                        .map((entry) => ({ ...entry, folderName }))
                    : [];
                // "files" есть только в отчётах, выгруженных после появления
                // списка файлов в "Таблице по разделам"; в старых отчётах его
                // нет — тогда для архивной даты список файлов просто недоступен
                const hasFiles = Array.isArray(data.files);
                const files = hasFiles
                    ? data.files
                        .filter((entry) => entry && typeof entry.fileName === 'string')
                        .map((entry) => ({
                            folderName,
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
                    hasFiles,
                };
            })
        )
    ).then((list) => list.filter(Boolean).sort((a, b) => a.date - b.date));
}

// ===== Сумма по выбранным папкам =====

function addValues(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
        target[key] = (target[key] || 0) + (Number(value) || 0);
    });
}

/**
 * Точки той же формы, что и отчёт одной папки: даты — объединение дат всех
 * выбранных папок; на каждую дату total, sections и pairs СУММИРУЮТСЯ, у
 * папки без отчёта на эту дату вклад 0 (прошлые значения не переносятся).
 * foldersWithoutFiles — папки, чей отчёт на эту дату без списка "files"
 * (по их файлам изменение относительно этой даты не показывается).
 */
function buildAggregatedPoints(selectedFolders) {
    const pointsByKey = new Map();
    selectedFolders.forEach((folder) => {
        folder.archivePoints.forEach((point) => {
            let aggregated = pointsByKey.get(point.key);
            if (!aggregated) {
                aggregated = {
                    key: point.key,
                    date: point.date,
                    total: 0,
                    sections: {},
                    pairs: {},
                    guidEntries: [],
                    files: [],
                    foldersWithoutFiles: new Set(),
                };
                pointsByKey.set(point.key, aggregated);
            }
            aggregated.total += point.total;
            addValues(aggregated.sections, point.sections);
            addValues(aggregated.pairs, point.pairs);
            // concat, а не push(...): GUID в отчёте могут быть десятки тысяч
            aggregated.guidEntries = aggregated.guidEntries.concat(point.guidEntries);
            aggregated.files = aggregated.files.concat(point.files);
            if (!point.hasFiles) aggregated.foldersWithoutFiles.add(folder.name);
        });
    });
    return [...pointsByKey.values()].sort((a, b) => a.date - b.date);
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

    // жирность числа — в style.css (--font-table-number-weight), не здесь
    return `<td class="${cellClass}" style="background-color: ${color}; color: ${textColor};">${value}${deltaIndicator}</td>`;
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
        .sort((a, b) => b.total - a.total
            || a.folderName.localeCompare(b.folderName, undefined, { numeric: true })
            || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
}

/**
 * Файл сравнивается с начальной датой по паре "папка + имя файла": в разных
 * папках могут быть файлы с одинаковыми именами
 */
function getFileKey(file) {
    return `${file.folderName}|${file.fileName}`;
}

/**
 * files — список файлов конечной даты (для архивной даты есть только в
 * отчётах, выгруженных с полем "files"); если списка нет — строки не
 * раскрываются. referenceData.files — для индикатора изменения по каждому
 * файлу (кроме папок, чей отчёт на начальную дату без списка файлов).
 */
function renderSectionTable(records, referenceData, files = []) {
    sectionTableBody.innerHTML = '';
    const refRecords = referenceData ? sectionsToClashRecords(referenceData.sections) : [];
    const disciplines = getPresentDisciplines([...records, ...refRecords]);
    if (!disciplines.length) return;
    const rows = disciplines.map(d => ({ discipline: d, total: getDisciplineTotal(records, d) }));
    rows.sort((a, b) => b.total - a.total);

    const refFiles = referenceData
        ? new Map((referenceData.files || []).map((file) => [getFileKey(file), file.total]))
        : null;
    const refFoldersWithoutFiles = (referenceData && referenceData.foldersWithoutFiles) || new Set();
    // при нескольких выбранных папках у имени файла есть префикс папки
    const showFolderPrefix = selectedFolderNames.size > 1;

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
        html += `<td class="section-table__discipline">${escapeHtml(row.discipline)}<span class="section-table__toggle">▸</span></td>`;
        html += renderHeatCell(row.total, '', refValue);
        html += '</tr>';

        disciplineFiles.forEach((file) => {
            const refFileValue = refFiles && !refFoldersWithoutFiles.has(file.folderName)
                ? (refFiles.get(getFileKey(file)) || 0)
                : undefined;
            const name = escapeHtml(showFolderPrefix ? `${file.folderName} / ${file.fileName}` : file.fileName);
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
    const padding = CHART_PADDING;
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
        // dominant-baseline="hanging": даты висят под осью, не наезжая на неё
        // при любом масштабе шрифта
        axisLabels += `<text x="${coord.x}" y="${chartBottom + 6}" dominant-baseline="hanging" class="chart-axis-label" text-anchor="${getDateLabelAnchor(idx, coords.length)}" fill="#333">${coord.label}</text>`;
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
    fitChartTextToScreen(totalChartBody.querySelector('svg'));
}

/**
 * SVG графиков растягивается под ширину плитки (viewBox), и вместе с ним
 * масштабируется текст подписей. Чтобы подписи осей на экране были ровно
 * --font-number-size (как числа в матрице), в CSS их размер делится на
 * масштаб SVG — его и выставляем в --chart-scale.
 */
function fitChartTextToScreen(svg) {
    if (!svg) return;
    const matrix = svg.getScreenCTM();
    const scale = matrix && matrix.a > 0 ? matrix.a : 1;
    svg.style.setProperty('--chart-scale', String(scale));
}

function fitAllChartsTextToScreen() {
    fitChartTextToScreen(totalChartBody.querySelector('svg'));
    fitChartTextToScreen(disciplineChartBody.querySelector('svg'));
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
    const padding = CHART_PADDING;
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
        axisLabelsHTML += `<text x="${x}" y="${chartBottom + 6}" dominant-baseline="hanging" class="chart-axis-label" text-anchor="${getDateLabelAnchor(idx, axisLabels.length)}" fill="#333">${axisLabels[idx]}</text>`;
    });

    // Линии и точки для каждой дисциплины. data-order — исходный порядок
    // отрисовки (все линии, затем все точки): applyDisciplineHighlight
    // переставляет элементы, а при снятии выделения возвращает этот порядок.
    // data-r/data-stroke-width — размеры точки, *-dimmed — для неактивной линии.
    let lines = '', markers = '';
    let lineOrder = 0;
    let markerOrder = series.length; // точки — после всех линий
    series.forEach(line => {
        const coords = line.values.map((val, i) => ({
            x: padding.left + stepX * i,
            y: chartBottom - (val / maxValue) * chartHeight,
        }));
        const linePoints = coords.map(c => `${c.x},${c.y}`).join(' ');
        lines += `<polyline points="${linePoints}" class="chart-line" data-discipline="${line.discipline}" data-stroke="${line.color}" data-order="${lineOrder++}" style="stroke: ${line.color}" />`;
        coords.forEach((coord, i) => {
            const isStart = i === startIdx;
            const isEnd = i === endIdx;
            const isSelected = isStart || isEnd;
            const pointStroke = line.color;
            const pointFill = isSelected ? '#ffffff' : line.color;
            const strokeWidth = isSelected ? 2.5 : 0;
            const radius = isSelected ? 5 : 3;
            const value = line.values[i];
            markers +=`<circle cx="${coord.x}" cy="${coord.y}" r="${radius}" class="chart-point" style="fill: ${pointFill}; stroke: ${pointStroke}; stroke-width: ${strokeWidth};" data-discipline="${line.discipline}" data-value="${value}" data-label="${axisLabels[i]}" data-index="${i}" data-cx="${coord.x}" data-cy="${coord.y}" data-fill="${pointFill}" data-stroke="${pointStroke}" data-order="${markerOrder++}" data-r="${radius}" data-r-dimmed="${isSelected ? 3.5 : 2}" data-stroke-width="${strokeWidth}" data-stroke-width-dimmed="${isSelected ? 1.5 : 0}" />`;
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
            <g class="chart-series">
                ${lines}
                ${markers}
            </g>
            ${axisLabelsHTML}
        </svg>
    `;
    fitChartTextToScreen(disciplineChartBody.querySelector('svg'));

    // отмеченные в легенде разделы остаются выделенными после перерисовки
    applyDisciplineHighlight(null);
}

// ===== Подсказка графиков и легенда графика по разделам =====

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

/**
 * Ближайшая к курсору точка графика не дальше TOOLTIP_HIT_RADIUS экранных
 * пикселей (или null). Координаты точек из viewBox переводятся в экранные
 * через getScreenCTM — с учётом масштаба SVG и полей preserveAspectRatio.
 */
function findNearestChartPoint(svg, circles, event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    let nearest = null;
    let nearestDistance = TOOLTIP_HIT_RADIUS;
    circles.forEach((circle) => {
        point.x = Number(circle.dataset.cx);
        point.y = Number(circle.dataset.cy);
        const screenPoint = point.matrixTransform(matrix);
        const distance = Math.hypot(screenPoint.x - event.clientX, screenPoint.y - event.clientY);
        // "<=": из совпадающих точек берётся нарисованная последней (верхняя)
        if (distance <= nearestDistance) {
            nearest = circle;
            nearestDistance = distance;
        }
    });
    return nearest;
}

/**
 * Выделенные разделы: раздел под курсором в легенде, иначе отмеченные в
 * легенде (только те, что сейчас есть на графике — иначе после смены фильтра
 * или папок все линии остались бы серыми без возможности снять отметку)
 */
function getHighlightedDisciplines(hoverDiscipline) {
    if (hoverDiscipline) return new Set([hoverDiscipline]);
    const present = new Set(Array.from(disciplineChartBody.querySelectorAll('.chart-legend__checkbox'))
        .map((checkbox) => checkbox.dataset.discipline));
    return new Set([...pinnedDisciplines].filter((discipline) => present.has(discipline)));
}

/**
 * Неактивные линии и их точки — серые, тоньше и рисуются ПОД активными
 * (элементы переставляются внутри .chart-series); без выделения — исходные
 * цвета, толщина и порядок (data-order)
 */
function applyDisciplineHighlight(hoverDiscipline) {
    const seriesGroup = disciplineChartBody.querySelector('.chart-series');
    if (!seriesGroup) return;
    const active = getHighlightedDisciplines(hoverDiscipline);
    const noFilter = active.size === 0;
    const elements = Array.from(seriesGroup.children);
    const isElementActive = (el) => noFilter || active.has(el.dataset.discipline);

    elements.forEach(el => {
        const isActive = isElementActive(el);
        el.style.stroke = isActive ? el.dataset.stroke : 'var(--color-muted)';
        if (el.classList.contains('chart-point')) {
            el.style.fill = isActive ? el.dataset.fill : 'var(--color-muted)';
            el.style.strokeWidth = isActive ? el.dataset.strokeWidth : el.dataset.strokeWidthDimmed;
            el.setAttribute('r', isActive ? el.dataset.r : el.dataset.rDimmed);
        } else {
            el.classList.toggle('chart-line--dimmed', !isActive);
        }
    });

    // слои снизу вверх: неактивные линии, их точки, активные линии, их точки
    const getLayer = (el) => (isElementActive(el) ? 2 : 0) + (el.classList.contains('chart-point') ? 1 : 0);
    elements
        .sort((a, b) => getLayer(a) - getLayer(b) || Number(a.dataset.order) - Number(b.dataset.order))
        .forEach((el) => seriesGroup.appendChild(el));
}

function setupDisciplineChartInteractions() {
    disciplineChartBody.addEventListener('mousemove', (event) => {
        const svg = disciplineChartBody.querySelector('svg');
        if (!svg || event.target.closest('.chart-legend')) { hideChartTooltip(); return; }
        // приоритет — у точек выделенных в легенде линий; если рядом таких
        // нет — ближайшая точка любой линии
        const circles = Array.from(svg.querySelectorAll('.chart-point'));
        const highlighted = getHighlightedDisciplines(null);
        let circle = null;
        if (highlighted.size) {
            circle = findNearestChartPoint(svg, circles.filter((c) => highlighted.has(c.dataset.discipline)), event);
        }
        if (!circle) circle = findNearestChartPoint(svg, circles, event);
        if (!circle) { hideChartTooltip(); return; }
        showChartTooltip(event, circle.dataset.label, circle.dataset.value, circle.dataset.discipline);
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

/**
 * Подсказка и линия-указатель появляются, когда курсор не дальше
 * TOOLTIP_HIT_RADIUS пикселей от точки (не только при точном наведении)
 */
function setupTotalChartInteractions() {
    const hideHover = () => {
        hideChartTooltip();
        const hoverLine = totalChartBody.querySelector('.chart-hover-line');
        if (hoverLine) hoverLine.style.display = 'none';
    };

    totalChartBody.addEventListener('mousemove', (event) => {
        const svg = totalChartBody.querySelector('svg');
        const circle = svg ? findNearestChartPoint(svg, svg.querySelectorAll('.chart-point'), event) : null;
        if (!circle) { hideHover(); return; }

        // Позиционируем относительно мыши, а не точки
        showChartTooltip(event, circle.dataset.label || '', circle.dataset.value || '');

        // Линия-указатель через выбранную точку
        const hoverLine = svg.querySelector('.chart-hover-line');
        if (hoverLine) {
            const cx = parseFloat(circle.getAttribute('cx'));
            const viewBox = svg.viewBox.baseVal;
            hoverLine.setAttribute('x1', cx);
            hoverLine.setAttribute('x2', cx);
            hoverLine.setAttribute('y1', CHART_PADDING.top);
            hoverLine.setAttribute('y2', viewBox.height - CHART_PADDING.bottom);
            hoverLine.style.display = 'block';
        }
    });

    totalChartBody.addEventListener('mouseleave', hideHover);
}

// ===== Работа с датами =====

/**
 * Все данные дашборда берутся ТОЛЬКО из JSON-отчётов папок "!АРХИВ":
 * index — номер даты в archivePoints (сумма выбранных подпапок, по дате из
 * имени файла). Точки "Сейчас" нет — XML-файлы сайт не читает.
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
        foldersWithoutFiles: point.foldersWithoutFiles || new Set(),
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
    // без данных (ничего не загружено или не выбрана ни одна папка)
    // getDataForDate вернёт null — дашборд пустой, с прочерками
    const startData = getDataForDate(startDateIndex);
    const endData = getDataForDate(endDateIndex);
    // "всего" и процент — всегда по ПОСЛЕДНЕЙ дате (последний отчёт по дате
    // в имени файла), независимо от выбранной конечной даты
    const latestData = getDataForDate(archivePoints.length - 1);
    if (!startData || !endData || !latestData) {
        hideChartTooltip();
        totalCollisionsValue.textContent = '—';
        changePercentValue.textContent = '—';
        setColor(changePercentValue, 0);
        periodDeltaValue.textContent = '—';
        setColor(periodDeltaValue, 0);
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

// ===== Загрузка выбранной папки =====

/**
 * allFiles — файлы-кандидаты с путём в webkitRelativePath (от выбранной
 * папки); отчёты отбираются по isArchiveReportFile и группируются по
 * подпапкам. Подпапки без отчётов в список не попадают. Повторная загрузка
 * полностью заменяет прежние данные.
 */
async function loadFolders(rootName, allFiles) {
    const filesByFolder = new Map();
    allFiles.filter(isArchiveReportFile).forEach((file) => {
        const folderName = getReportFolderName(file);
        if (!filesByFolder.has(folderName)) filesByFolder.set(folderName, []);
        filesByFolder.get(folderName).push(file);
    });

    const loadedFolders = await Promise.all([...filesByFolder].map(([name, files]) =>
        buildArchivePoints(files, name).then((points) => ({ name, archivePoints: points }))
    ));
    const nonEmptyFolders = loadedFolders.filter((folder) => folder.archivePoints.length > 0);
    if (!nonEmptyFolders.length) {
        // прежние данные (если были) не трогаем
        const where = rootName ? `В папке "${rootName}"` : 'В выбранной папке';
        alert(`${where} не найдено ни одного отчёта. Ожидается: <подпапка>/${ARCHIVE_FOLDER_NAME}/<имя подпапки>_дд-мм-гггг.json`);
        return;
    }
    nonEmptyFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    resetDashboard();
    folders = nonEmptyFolders;

    // список разделов фильтра — один раз, по ВСЕМ загруженным папкам: при
    // смене выбора папок фильтр разделов не сбрасывается
    const allRecordsForFilters = folders
        .flatMap((folder) => folder.archivePoints)
        .flatMap((point) => sectionsToClashRecords(point.sections));
    rebuildDisciplineFilters(getPresentDisciplines(allRecordsForFilters));

    // по умолчанию — "Все"
    selectedFolderNames = new Set(folders.map((folder) => folder.name));
    rebuildFolderFilter();
    applyFolderSelection();
}

/**
 * Пересчёт после смены выбора папок: сумма по выбранным папкам, даты по
 * умолчанию, сброс зума и раскрытых строк таблицы (фильтр разделов и
 * отметки в легенде сохраняются)
 */
function applyFolderSelection() {
    zoomState.total.end = null;
    zoomState.discipline.end = null;
    expandedSections = new Set();

    const selectedFolders = folders.filter((folder) => selectedFolderNames.has(folder.name));
    archivePoints = buildAggregatedPoints(selectedFolders);

    updateFolderFilterState();
    setDefaultDates();
    updateDashboard();
    updatePdfButtonState();
}

// ===== Фильтр папок =====

/**
 * Число столбцов для вертикального списка с галочками: пока пунктов не
 * больше maxRows — один столбец, дальше — до maxColumns (ширина сайдбара
 * 300px; что не поместилось — прокручивается)
 */
function getListColumnCount(itemsCount, maxRows, maxColumns) {
    return Math.min(maxColumns, Math.max(1, Math.ceil(itemsCount / maxRows)));
}

function rebuildFolderFilter() {
    folderFilter.hidden = folders.length === 0;
    folderFilterOptions.innerHTML = '';
    folderFilterOptions.style.setProperty('--list-columns', getListColumnCount(folders.length, 8, 2));
    folders.forEach((folder) => {
        const label = document.createElement('label');
        label.className = 'folder-filter__item';
        label.title = folder.name;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'folder-filter__checkbox';
        checkbox.value = folder.name;
        const name = document.createElement('span');
        name.className = 'folder-filter__name';
        name.textContent = folder.name;
        label.appendChild(checkbox);
        label.appendChild(name);
        folderFilterOptions.appendChild(label);
    });
    updateFolderFilterState();
}

/**
 * Галочки и надпись на кнопке — по selectedFolderNames; "Все" отмечено,
 * только когда отмечены все папки
 */
function updateFolderFilterState() {
    const selectedCount = folders.filter((folder) => selectedFolderNames.has(folder.name)).length;
    folderFilterAll.checked = folders.length > 0 && selectedCount === folders.length;
    folderFilterOptions.querySelectorAll('.folder-filter__checkbox').forEach((checkbox) => {
        checkbox.checked = selectedFolderNames.has(checkbox.value);
    });
    folderFilterLabel.textContent = getFolderSelectionText('Все', 'Папки не выбраны', `Выбрано папок: ${selectedCount}`);
}

/**
 * Текст о выбранных папках: allText — выбраны все, noneText — ни одной,
 * manyText — несколько (одна папка — её имя)
 */
function getFolderSelectionText(allText, noneText, manyText) {
    const selected = folders.filter((folder) => selectedFolderNames.has(folder.name));
    if (!selected.length) return noneText;
    if (selected.length === folders.length) return allText;
    if (selected.length === 1) return selected[0].name;
    return manyText;
}

function closeFolderFilter() {
    folderFilterPanel.classList.remove('folder-dropdown__list--open');
    folderFilterToggle.setAttribute('aria-expanded', 'false');
}

function resetDashboard() {
    zoomState.total.end = null;
    zoomState.discipline.end = null;

    folders = [];
    selectedFolderNames = new Set();
    archivePoints = [];
    pinnedDisciplines = new Set();
    expandedSections = new Set();
    disciplineFilterList.innerHTML = '';
    disciplineFilter = new Set();
    totalCollisions = 'N';
    changePercent = 0;
    startDateIndex = -1;
    endDateIndex = -1;

    folderFilter.hidden = true;
    folderFilterOptions.innerHTML = '';
    updateFolderFilterState();
    closeFolderFilter();

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
    updatePdfButtonState();
    updateZoomButtonVisibility();
}

// ===== Выбор папки через File System Access API =====

/**
 * Выбор папки через системный диалог (Chrome/Edge). В отличие от
 * <input webkitdirectory>, браузер НЕ перечисляет заранее все файлы папки —
 * код сам читает только нужное, см. collectReportFilesFromDirectoryHandle.
 */
async function pickFolderWithDirectoryPicker() {
    let rootHandle;
    try { rootHandle = await window.showDirectoryPicker(); } catch (e) { return; } // диалог закрыт
    try {
        const files = await collectReportFilesFromDirectoryHandle(rootHandle);
        await loadFolders(rootHandle.name, files);
    } catch (error) {
        console.error('Не удалось прочитать папку:', error);
        alert('Не удалось прочитать папку — подробности в консоли (F12).');
    }
}

/**
 * Обходятся только нужные уровни: выбранная папка -> её подпапки -> "!АРХИВ"
 * (по имени, без перебора остального содержимого подпапки) -> .json с именем
 * "<имя подпапки>_дд-мм-гггг.json". Глубже код не заходит.
 */
async function collectReportFilesFromDirectoryHandle(rootHandle) {
    const results = [];
    for await (const [folderName, folderHandle] of rootHandle.entries()) {
        if (folderHandle.kind !== 'directory') continue;
        let archiveHandle;
        try {
            archiveHandle = await folderHandle.getDirectoryHandle(ARCHIVE_FOLDER_NAME);
        } catch (e) {
            continue; // в подпапке нет "!АРХИВ"
        }
        for await (const [fileName, fileHandle] of archiveHandle.entries()) {
            if (fileHandle.kind !== 'file') continue;
            const parsed = parseReportFileName(fileName);
            if (!parsed || parsed.folderNamePart !== folderName) continue;
            const file = await fileHandle.getFile();
            setRelativePath(file, [rootHandle.name, folderName, ARCHIVE_FOLDER_NAME, fileName]);
            results.push(file);
        }
    }
    return results;
}

/**
 * Путь от выбранной папки — как у файлов из <input webkitdirectory>, чтобы
 * все способы выбора проходили через один isArchiveReportFile
 */
function setRelativePath(file, segments) {
    Object.defineProperty(file, 'webkitRelativePath', { value: segments.join('/'), configurable: true });
}

// ===== Drag & Drop =====

/**
 * Перетаскивание папки — то же, что её выбор кнопкой. Берётся первая
 * перетащенная папка; webkitGetAsEntry доступен только синхронно, внутри
 * обработчика drop.
 */
function handleDroppedItems(dataTransferItems) {
    const rootEntry = Array.from(dataTransferItems)
        .filter((item) => item.kind === 'file' && typeof item.webkitGetAsEntry === 'function')
        .map((item) => item.webkitGetAsEntry())
        .find((entry) => entry && entry.isDirectory);
    if (!rootEntry) return;
    collectReportFilesFromEntry(rootEntry)
        .then((files) => loadFolders(rootEntry.name, files))
        .catch((error) => {
            console.error('Не удалось прочитать папку:', error);
            alert('Не удалось прочитать папку — подробности в консоли (F12).');
        });
}

/**
 * Те же уровни, что и в collectReportFilesFromDirectoryHandle: перетащенная
 * папка -> её подпапки -> "!АРХИВ" -> .json отчёты этой подпапки
 */
async function collectReportFilesFromEntry(rootEntry) {
    const results = [];
    const folderEntries = (await readAllDirectoryEntries(rootEntry)).filter((entry) => entry.isDirectory);
    for (const folderEntry of folderEntries) {
        const archiveEntry = await getChildDirectoryEntry(folderEntry, ARCHIVE_FOLDER_NAME);
        if (!archiveEntry) continue;
        const fileEntries = (await readAllDirectoryEntries(archiveEntry)).filter((entry) => entry.isFile);
        for (const fileEntry of fileEntries) {
            const parsed = parseReportFileName(fileEntry.name);
            if (!parsed || parsed.folderNamePart !== folderEntry.name) continue;
            const file = await readEntryAsFile(fileEntry);
            setRelativePath(file, [rootEntry.name, folderEntry.name, ARCHIVE_FOLDER_NAME, fileEntry.name]);
            results.push(file);
        }
    }
    return results;
}

/**
 * Вложенная папка по имени (или null). Если getDirectory недоступен —
 * ищем среди непосредственного содержимого папки.
 */
function getChildDirectoryEntry(dirEntry, name) {
    if (typeof dirEntry.getDirectory !== 'function') {
        return readAllDirectoryEntries(dirEntry)
            .then((entries) => entries.find((entry) => entry.isDirectory && entry.name === name) || null);
    }
    return new Promise((resolve) => dirEntry.getDirectory(name, {}, resolve, () => resolve(null)));
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

// ===== Выгрузка в PDF =====

/**
 * Кнопка активна, только когда есть данные для дашборда (папка загружена и
 * в фильтре папок отмечена хотя бы одна)
 */
function updatePdfButtonState() {
    if (!btnExportPdf) return;
    const hasData = archivePoints.length > 0;
    btnExportPdf.disabled = !hasData;
    if (hasData) btnExportPdf.title = '';
    else btnExportPdf.title = folders.length ? 'Не выбрана ни одна папка' : 'Выберите папку с отчётами';
}

/**
 * Шапка PDF — собирается из текущих значений сайдбара (вставляется только в
 * копию страницы, которую рисует html2canvas, на сам сайт не влияет)
 */
function buildPdfHeader(targetDocument) {
    const today = new Date();
    const dateText = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    const checkedDisciplines = Array.from(disciplineFilterList.querySelectorAll('.discipline-filter__checkbox'))
        .filter((checkbox) => checkbox.checked)
        .map((checkbox) => checkbox.value);
    const allDisciplinesCount = disciplineFilterList.querySelectorAll('.discipline-filter__checkbox').length;
    const filterText = checkedDisciplines.length === allDisciplinesCount ? 'все разделы' : (checkedDisciplines.join(', ') || '—');
    const selectedNames = folders.filter((folder) => selectedFolderNames.has(folder.name)).map((folder) => folder.name);
    const foldersText = getFolderSelectionText('все папки', '—', selectedNames.join(', '));

    const header = targetDocument.createElement('div');
    header.className = 'pdf-header';
    header.innerHTML = `
        <div class="pdf-header__title">Отчёт по коллизиям — ${escapeHtml(projectName)}</div>
        <div class="pdf-header__line">Папки: ${escapeHtml(foldersText)}</div>
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
    if (!archivePoints.length) return;
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
                clonedContent.insertBefore(buildPdfHeader(clonedDocument), clonedContent.firstChild);
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
        pdf.save(`${projectName}_${dateKey}.pdf`);
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

projectNameTitle.textContent = projectName;
projectNameTitle.title = projectName;

btnSelectFolder.addEventListener('click', () => {
    // системный диалог выбора папки — где он доступен (Chrome/Edge);
    // <input webkitdirectory> — запасной вариант (Firefox и т.п.), там браузер
    // сам перечисляет ВСЕ файлы папки, а нужные отбирает isArchiveReportFile
    if (canUseDirectoryPicker) pickFolderWithDirectoryPicker();
    else folderInput.click();
});

folderInput.addEventListener('change', () => {
    const allFiles = Array.from(folderInput.files);
    folderInput.value = '';
    const rootName = allFiles.length ? (allFiles[0].webkitRelativePath || allFiles[0].name).split('/')[0] : '';
    loadFolders(rootName, allFiles).catch((error) => {
        console.error('Не удалось прочитать папку:', error);
        alert('Не удалось прочитать папку — подробности в консоли (F12).');
    });
});

disciplineFilterList.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.discipline-filter__checkbox');
    if (!checkbox) return;
    if (checkbox.checked) disciplineFilter.add(checkbox.value);
    else disciplineFilter.delete(checkbox.value);
    updateDashboard();
});

folderFilterToggle.addEventListener('click', () => {
    const isOpen = folderFilterPanel.classList.toggle('folder-dropdown__list--open');
    folderFilterToggle.setAttribute('aria-expanded', String(isOpen));
});

// "Все": отметили — отмечены все папки, сняли — сняты все
folderFilterAll.addEventListener('change', () => {
    selectedFolderNames = folderFilterAll.checked ? new Set(folders.map((folder) => folder.name)) : new Set();
    applyFolderSelection();
});

// отдельная папка; "Все" обновится само в updateFolderFilterState
folderFilterOptions.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.folder-filter__checkbox');
    if (!checkbox) return;
    if (checkbox.checked) selectedFolderNames.add(checkbox.value);
    else selectedFolderNames.delete(checkbox.value);
    applyFolderSelection();
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
    // клики по галочкам внутри фильтра папок его не закрывают
    if (!folderFilter.contains(event.target)) {
        closeFolderFilter();
    }
});

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

    // всегда два столбца (см. .discipline-filter__list): строк — половина пунктов
    disciplineFilterList.style.setProperty('--list-rows', Math.max(1, Math.ceil(newFilter.size / 2)));

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

    const zoom = zoomState[graphType];
    // без зума (end === null) виден весь диапазон, start при этом не учитывается
    const currentStart = (zoom.end !== null) ? zoom.start : 0;
    const currentEnd = (zoom.end !== null) ? zoom.end : totalPoints - 1;
    const currentRange = currentEnd - currentStart + 1;

    // Точка под курсором: курсор переводится в координаты viewBox (с учётом
    // масштаба и полей preserveAspectRatio), затем — в индекс среди ВИДИМЫХ
    // сейчас точек, с теми же отступами CHART_PADDING, что и при отрисовке
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const svgX = cursor.matrixTransform(matrix.inverse()).x;
    const chartWidth = svg.viewBox.baseVal.width - CHART_PADDING.left - CHART_PADDING.right;
    if (chartWidth <= 0) return;

    const fraction = Math.max(0, Math.min(1, (svgX - CHART_PADDING.left) / chartWidth));
    const pointIndex = currentStart + Math.round(fraction * (currentRange - 1));
    const clamped = Math.max(0, Math.min(totalPoints - 1, pointIndex));

    const delta = event.deltaY;
    let newStart = currentStart;
    let newEnd = currentEnd;

    // колесо вверх (deltaY < 0) — приближение к точке под курсором,
    // колесо вниз — отдаление
    if (delta < 0) {
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

// при изменении размера окна меняется масштаб SVG графиков — подписи осей
// пересчитываются, чтобы на экране оставаться того же размера
window.addEventListener('resize', fitAllChartsTextToScreen);