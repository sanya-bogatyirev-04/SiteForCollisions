const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Порт локального сервера
const PORT = 5500;

// Страница, которая должна открыться при запуске .exe
const START_PAGE = 'index-admin.html';

// Определяем папку с файлами сайта:
// - при обычном запуске через "node server.js" — это папка рядом со скриптом
// - при запуске собранного .exe (через pkg) — файлы сайта лежат рядом с .exe,
//   а не внутри "снапшота" exe, поэтому берём process.cwd() либо папку exe
const baseDir = process.pkg
    ? path.dirname(process.execPath)
    : __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = `/${START_PAGE}`;

    const filePath = path.join(baseDir, urlPath);

    // Защита от выхода за пределы папки сайта
    if (!filePath.startsWith(baseDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Файл не найден: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}/${START_PAGE}`;
    console.log('Сервер запущен: ' + url);
    console.log('Не закрывайте это окно, пока пользуетесь сайтом.');

    // Открываем страницу в браузере по умолчанию
    const openCommand = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;

    exec(openCommand);
});
