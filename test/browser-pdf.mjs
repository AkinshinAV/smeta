import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smeta-pdf-'));
const pdfPath = path.join(dir, 'smeta.pdf');
const scanPath = path.join(dir, 'scan.pdf');
const badPath = path.join(dir, 'bad.pdf');
const lockedPath = path.join(dir, 'locked.pdf');
execFileSync('python3', ['-c', `
import pymupdf
d = pymupdf.open()
p = d.new_page()
font = ${JSON.stringify(path.join(root, 'fonts/LiberationSerif-Regular.ttf'))}
text = """Приложение №1
Помещение
Кухня
Площадь, кв.м. 12
Демонтажные работы
Стены Снятие обоев 99 р. 12 м2 1 188 р.
Итого - Демонтажные работы 1 188 р.
Загадочная позиция 10 р. 1 шт 10 р.
<img src=x onerror=alert(1)> 15 р. 1 шт 15 р.
Итого по помещению - Кухня 1 213 р.
В том числе НДС 5% 57 р. 76 коп.
"""
p.insert_text((40, 40), text, fontfile=font, fontname="f", fontsize=11)
s = d.new_page()
s.insert_text((40, 40), "Сводная по всем помещениям\\nКухня 1 188 р.\\nИтого 1 188 р.", fontfile=font, fontname="f", fontsize=11)
d.save(${JSON.stringify(pdfPath)})
img = pymupdf.open()
page = img.new_page()
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), 1)
pix.clear_with(255)
page.insert_image(pymupdf.Rect(40, 40, 80, 80), pixmap=pix)
img.save(${JSON.stringify(scanPath)})
open(${JSON.stringify(badPath)}, "w").write("%PDF-1.4\\nnot a pdf")
lock = pymupdf.open()
lp = lock.new_page()
lp.insert_text((40, 40), "Снятие обоев 99 р. 12 м2 1 188 р.", fontfile=font, fontname="f", fontsize=11)
lock.save(${JSON.stringify(lockedPath)}, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="secret-owner", user_pw="secret-user")
print("pdfs-ok")
`]);

const port = 8796;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 300));
const browser = await puppeteer.launch({ executablePath: '/usr/local/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const results = [];
function ok(name, cond, detail) { results.push({ name, ok: !!cond, detail: detail || '' }); console.log(cond ? 'OK' : 'FAIL', name, detail || ''); }

async function loadFile(page, filePath, name) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  return page.evaluate(async (data, fileName) => {
    const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const file = new File([bin], fileName, { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('imp-pdf');
    input.files = dt.files;
    await importPdfFile(input);
    return document.getElementById('pdfMsg').textContent;
  }, b64, name);
}

try {
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.dismiss(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  const before = await page.evaluate(() => ({ rooms: S.rooms.length, estimates: LIB.objects[0].estimates.length, client: S.client }));
  const msg = await loadFile(page, pdfPath, 'smeta.pdf');
  const preview = await page.evaluate(() => ({
    open: !document.getElementById('pdfBox').hidden,
    html: document.getElementById('pdfRows').innerHTML,
    text: document.getElementById('pdfRows').innerText,
    rows: pdfDraft.rows.map(r => ({ name: r.sourceName, include: r.include }))
  }));
  ok('предпросмотр показывает позицию каталога и не отмечает сомнительную', preview.open && preview.rows.some(r => r.name === 'Снятие обоев' && r.include) && preview.rows.some(r => r.name.startsWith('Загадочная') && !r.include) && preview.text.includes('не сопоставлено'), JSON.stringify(preview.rows));
  await page.screenshot({ path: '/opt/cursor/artifacts/objects/pdf-preview.png' });
  ok('текст из PDF не исполняется как HTML', preview.html.includes('&lt;img') && !preview.html.includes('<img') && dialogs.length === 0, preview.html.slice(0, 180));
  ok('сводка не стала позицией', !preview.text.includes('Сводная') || preview.text.includes('сводн'), msg);
  await page.click('button[onclick="applyPdf(\'new\')"]');
  await page.waitForFunction(() => document.getElementById('pdfBox').hidden);
  const after = await page.evaluate(() => ({
    rooms: S.rooms.map(r => ({ name: r.name, works: r.works.map(w => w.name) })),
    estimates: LIB.objects[0].estimates.length,
    firstWorks: LIB.objects[0].estimates[0].estimate.rooms.length,
    hidden: document.getElementById('pdfBox').hidden
  }));
  ok('новая смета не затирает прежнюю', after.estimates === before.estimates + 1 && after.firstWorks === 0 && after.rooms.some(r => r.name === 'Кухня' && r.works.includes('Снятие обоев') && !r.works.some(w => w.includes('Загадочная'))), JSON.stringify(after));
  await page.evaluate(() => copyRoom(0));
  const copied = await page.evaluate(() => S.rooms.map(r => ({ name: r.name, n: r.works.length })));
  ok('помещение копируется вместе с позициями', copied.length === 2 && copied[1].name.includes('копия') && copied[1].n === copied[0].n, JSON.stringify(copied));

  await page.evaluate(() => { document.getElementById('pdfPaste').value = 'Укладка ламината с подложкой 962 р. 8 м2 7 696 р.'; parsePdfPaste(); });
  const pasted = await page.evaluate(() => pdfDraft.rows.map(r => r.name));
  ok('вставленный текст разбирается без PDF', pasted.includes('Укладка ламината с подложкой'), pasted.join('|'));
  await page.click('button[onclick="closePdf()"]');
  const cancelled = await page.evaluate(() => ({ hidden: document.getElementById('pdfBox').hidden, rooms: S.rooms.map(r => r.name) }));
  ok('отмена не меняет открытую смету', cancelled.hidden && cancelled.rooms.includes('Кухня'), JSON.stringify(cancelled));

  const scanMsg = await loadFile(page, scanPath, 'scan.pdf');
  ok('скан честно без OCR', scanMsg.includes('нет текстового слоя'), scanMsg);
  const badMsg = await loadFile(page, badPath, 'bad.pdf');
  ok('битый PDF не разбирается молча', /не читается|не разобран/.test(badMsg), badMsg);
  const lockedMsg = await loadFile(page, lockedPath, 'locked.pdf');
  ok('закрытый PDF сообщает про пароль', /парол/.test(lockedMsg), lockedMsg);
  const big = await page.evaluate(() => SmetaPdf.fileProblem({ name: 'big.pdf', size: SmetaPdf.MAX_BYTES + 5 }));
  ok('слишком большой PDF отклоняется до разбора', big.includes('8 МБ'), big);
  const sampleMsg = await loadFile(page, '/opt/cursor/artifacts/smeta-sample.pdf', 'sample.pdf');
  const sampleRows = await page.evaluate(() => (pdfDraft && pdfDraft.rows || []).map(r => ({ name: r.name, room: r.room, include: r.include })));
  ok('печатный образец сметы даёт черновик снятия обоев', sampleRows.some(r => r.name === 'Снятие обоев' && r.include && r.room === 'Комната') && !sampleRows.some(r => /сводн/i.test(r.name)), JSON.stringify(sampleRows));
  await page.click('button[onclick="closePdf()"]');
  ok('страница PDF без исключений', errors.length === 0 && dialogs.length === 0, errors.concat(dialogs).join(' | '));
  if (results.some(r => !r.ok)) process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
