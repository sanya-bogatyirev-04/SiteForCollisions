const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// ===== Те же константы, что и в script.js (см. основной сайт) =====

const KNOWN_DISCIPLINES = ["АР", "КР", "ВК", "ЭОМ", "ВиК", "ОТМ", "СС", "АПТ-ВПВ", "КЖ", "АУПТ", "ИТП"];
const DISCIPLINES_BY_LENGTH = [...KNOWN_DISCIPLINES].sort((a, b) => b.length - a.length);
const NOT_DEFINED = "Не опр.";
const FILE_NAME_NUMBER_RE = /^\d+(\.\d+)?_|_\d+(\.\d+)?$/g;
const ARCHIVE_FOLDER_NAME = '!АРХИВ';

// Лог-файл рядом с exe — чтобы всегда можно было понять, что произошло,
// даже если по какой-то причине не открылось окно с сообщением
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;

// ===== Запуск PowerShell-скрипта через временный .ps1-файл =====

function runPowerShellScript(scriptText) {
    const tmpFile = path.join(os.tmpdir(), `collision-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    // BOM нужен, чтобы PowerShell корректно прочитал кириллицу в UTF-8
    fs.writeFileSync(tmpFile, '\uFEFF' + scriptText, 'utf8');
    try {
        return execFileSync('powershell.exe', [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy', 'Bypass',
            '-File', tmpFile,
        ], { encoding: 'utf8' });
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) { /* временный файл не критичен */ }
    }
}

function pickFolderWithExplorer() {
    // Путь пишем PowerShell-ом сразу в файл в кодировке UTF-8 (без BOM), а не
    // через stdout — консоль PowerShell использует свою кодовую страницу
    // (обычно OEM 866), из-за чего кириллица в пути превращалась бы в
    // кракозябры при чтении через execFileSync.
    const resultFile = path.join(os.tmpdir(), `collision-tool-path-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    try {
        runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Выберите папку с XML-отчётами о коллизиях"
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [System.IO.File]::WriteAllText("${resultFile.replace(/\\/g, '\\\\')}", $dialog.SelectedPath, [System.Text.Encoding]::UTF8)
}
`);
        if (!fs.existsSync(resultFile)) {
            return ''; // пользователь нажал "Отмена"
        }
        // UTF8 без BOM — читаем как обычный текст
        return fs.readFileSync(resultFile, 'utf8').trim();
    } finally {
        try { fs.unlinkSync(resultFile); } catch (e) { /* временный файл не критичен */ }
    }
}

function showMessageBox(text, title, isError = false) {
    const icon = isError ? 'Error' : 'Information';
    // Значения подставляются через переменные окружения, а не строковую
    // подстановку в тело скрипта — так не ломается на кавычках/спецсимволах
    const tmpFile = path.join(os.tmpdir(), `collision-tool-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$text = [System.Environment]::GetEnvironmentVariable("CT_MSG_TEXT")
$title = [System.Environment]::GetEnvironmentVariable("CT_MSG_TITLE")
[System.Windows.Forms.MessageBox]::Show($text, $title, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::${icon})
`;
    fs.writeFileSync(tmpFile, '\uFEFF' + script, 'utf8');
    try {
        execFileSync('powershell.exe', [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy', 'Bypass',
            '-File', tmpFile,
        ], {
            encoding: 'utf8',
            env: { ...process.env, CT_MSG_TEXT: text, CT_MSG_TITLE: title },
        });
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (e) { /* временный файл не критичен */ }
    }
}

// ===== Разбор пары разделов из имени файла (как в script.js) =====

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

// ===== Чтение GUID из XML (аналог collectClashGuids из script.js) =====

function collectClashGuids(filePath) {
    const text = fs.readFileSync(filePath, 'utf8');
    const guids = [];
    const re = /<clashresult\b[^>]*\bguid="([^"]+)"/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
        guids.push(match[1]);
    }
    return guids;
}

// ===== Сбор ClashRecord-ов по XML-файлам верхнего уровня папки =====

function buildClashRecords(folderPath) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const xmlFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.xml'));

    return xmlFiles.map((entry) => {
        const nameWithoutExtension = entry.name.replace(/\.xml$/i, '');
        const [firstDiscipline, secondDiscipline] = parseDisciplinePair(nameWithoutExtension);
        const guids = collectClashGuids(path.join(folderPath, entry.name));
        return {
            discipline1: firstDiscipline || NOT_DEFINED,
            discipline2: secondDiscipline || NOT_DEFINED,
            total: guids.length,
            guids,
        };
    });
}

// ===== Сводные данные (как в script.js) =====

function getPresentDisciplines(records) {
    const present = new Set();
    records.forEach((r) => { present.add(r.discipline1); present.add(r.discipline2); });
    present.delete('');
    const known = KNOWN_DISCIPLINES.filter((d) => present.has(d));
    const other = [...present].filter((d) => !KNOWN_DISCIPLINES.includes(d)).sort();
    return [...known, ...other];
}

function getDisciplineTotal(records, discipline) {
    let total = 0;
    records.forEach((r) => {
        if (r.discipline1 === discipline) total += r.total;
        if (r.discipline2 === discipline && r.discipline1 !== discipline) total += r.total;
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
                .filter((r) => r.discipline1 === row && r.discipline2 === col)
                .reduce((s, r) => s + r.total, 0);
            if (row === col) { matrix[row][col] = straight; return; }
            const reverse = records
                .filter((r) => r.discipline1 === col && r.discipline2 === row)
                .reduce((s, r) => s + r.total, 0);
            matrix[row][col] = straight + reverse;
        });
    });
    return matrix;
}

function getGuidEntries(records) {
    const entries = [];
    records.forEach((r) => {
        (r.guids || []).forEach((guid) => {
            entries.push({ guid, discipline1: r.discipline1, discipline2: r.discipline2 });
        });
    });
    return entries;
}

// ===== Формирование и запись отчёта (как exportReport в script.js) =====

function exportReportForFolder(folderPath) {
    const folderName = path.basename(folderPath);
    const records = buildClashRecords(folderPath);

    if (!records.length) {
        throw new Error('В выбранной папке не найдено ни одного .xml-файла верхнего уровня (только в самой папке, не во вложенных).');
    }

    const disciplines = getPresentDisciplines(records);
    const sections = {};
    disciplines.forEach((d) => { sections[d] = getDisciplineTotal(records, d); });

    const matrix = buildCollisionMatrix(records, disciplines);
    const pairs = {};
    disciplines.forEach((row, ri) => {
        disciplines.forEach((col, ci) => {
            if (ci < ri) return;
            pairs[getPairKey(row, col)] = matrix[row][col];
        });
    });

    const guids = getGuidEntries(records);
    const total = records.reduce((s, r) => s + r.total, 0);

    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    const fileName = `${folderName}_${day}-${month}-${year}.json`;

    const reportData = { total, sections, pairs, guids };

    const archiveDir = path.join(folderPath, ARCHIVE_FOLDER_NAME);
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, fileName), JSON.stringify(reportData, null, 2), 'utf8');

    return { fileName, total };
}

// ===== Точка входа =====

function main() {
    let folderPath;
    try {
        folderPath = pickFolderWithExplorer();
    } catch (error) {
        try {
            showMessageBox(
                'Не удалось открыть диалог выбора папки: ' + error.message,
                'Ошибка',
                true
            );
        } catch (msgError) {
        }
        process.exit(1);
    }

    if (!folderPath) {
        process.exit(0);
    }

    try {
        const { fileName, total } = exportReportForFolder(folderPath);
        showMessageBox(
            `Отчёт сохранён: !АРХИВ\\${fileName}\nВсего конфликтов: ${total}`,
            'Выгрузка завершена'
        );
    } catch (error) {
        try {
            showMessageBox(
                'Не удалось выгрузить отчёт: ' + error.message,
                'Ошибка',
                true
            );
        } catch (msgError) {
        }
        process.exit(1);
    }

}

try {
    main();
} catch (fatalError) {
    process.exit(1);
}
