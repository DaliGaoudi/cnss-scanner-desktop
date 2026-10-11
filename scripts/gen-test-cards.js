/*
 * Generate a multi-page test PDF of fake "État de Liquidation / بطاقة جبر"
 * documents for exercising the bulk upload (one card per page). Rendered with
 * Electron's Chromium so the bilingual (FR/AR) layout reads cleanly for the AI.
 *
 *   npx electron scripts/gen-test-cards.js [outputPath]
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.argv[2] || path.join(os.homedir(), 'Downloads', 'test_bataqat_jabr.pdf');

// Test cards. #1 & #2 share numcnss 612555 → should group under ONE مطلوب;
// the rest are distinct employers (fan-out). dette is the rendered "FR" format
// (space thousands, comma decimal) the extractor expects.
const CARDS = [
    { nom: 'SARL DICIMOOV', adr: ['AVENUE KHALIFA  SAHLOUL  B1', '4002 SOUSSE JAWHARA'], numcnss: '612555', codeng: '00', numcarte: '4621400216', q: 4, year: 2021, dette: '2 959,306', words: 'DEUX MILLE NEUF CENT CINQUANTE-NEUF DINARS TROIS CENT SIX MILLIMES', date: '21-05-2026' },
    { nom: 'SARL DICIMOOV', adr: ['AVENUE KHALIFA  SAHLOUL  B1', '4002 SOUSSE JAWHARA'], numcnss: '612555', codeng: '00', numcarte: '4621400217', q: 1, year: 2022, dette: '3 120,450', words: 'TROIS MILLE CENT VINGT DINARS QUATRE CENT CINQUANTE MILLIMES', date: '21-05-2026' },
    { nom: 'STE EXEMPLE TRADING SARL', adr: ['RUE DE LA LIBERTE - IMM ENNOUR', '4000 SOUSSE'], numcnss: '318922', codeng: '11', numcarte: '4622400518', q: 2, year: 2023, dette: '1 845,200', words: 'MILLE HUIT CENT QUARANTE-CINQ DINARS DEUX CENT MILLIMES', date: '12-06-2026' },
    { nom: 'محمد علي بن صالح', adr: ['نهج الحبيب بورقيبة - عدد 12', '4011 حمام سوسة'], numcnss: '550867', codeng: '04', numcarte: '4613100072', q: 3, year: 2022, dette: '980,750', words: 'NEUF CENT QUATRE-VINGTS DINARS SEPT CENT CINQUANTE MILLIMES', date: '03-04-2026' },
    { nom: 'STE TECHNO PLUS SUARL', adr: ['ZONE INDUSTRIELLE SIDI ABDELHAMID', '4061 SOUSSE'], numcnss: '421033', codeng: '07', numcarte: '4621001999', q: 1, year: 2024, dette: '5 410,000', words: 'CINQ MILLE QUATRE CENT DIX DINARS', date: '30-01-2026' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cardHtml = (c) => `
<section class="card">
  <table class="hdr"><tr>
    <td class="fr">
      <b>République Tunisienne</b><br>Ministère des Affaires Sociales<br>
      Caisse Nationale de Sécurité Sociale<br>49, Avenue Taïeb M'hiri - Tunis<br>
      Tél : 71 796 744<br>Site web : www.cnss.tn
    </td>
    <td class="logo">✸</td>
    <td class="ar" dir="rtl">
      <b>الجمهورية التونسية</b><br>وزارة الشؤون الاجتماعية<br>
      الصندوق الوطني للضمان الاجتماعي<br>49 ، شارع الطيب المهيري - تونس<br>
      رقم الهاتف : 71 796 744<br>موقع الواب : www.cnss.tn
    </td>
  </tr></table>
  <hr>
  <table class="title"><tr>
    <td class="fr"><b>ETAT DE LIQUIDATION N°</b></td>
    <td class="ar" dir="rtl"><b>بطاقة جبر عدد &nbsp; ${esc(c.numcarte)}</b></td>
  </tr></table>

  <table class="body"><tr>
    <td class="fr">
      <p>Décerné par la Caisse Nationale de Sécurité Sociale en application des dispositions de
      l'article 105 de la loi n°60-30 du 14 décembre 1960 telle que modifiée et complétée par
      les textes subséquents.</p>
      <p>Pour infraction aux articles 45 et 46 de la loi n° 60-30 sus visée et à l'article 18 de
      la loi n° 94-28 du 21 février 1994, <b>l'employeur</b></p>
      <p class="emp"><b>${esc(c.nom)}</b><br>${c.adr.map(esc).join('<br>')}</p>
      <p>affilié sous le numéro &nbsp;&nbsp; <b>${esc(c.numcnss)} &nbsp; ${esc(c.codeng)}</b></p>
      <p>est contraint par toutes les voies de droit à payer le montant de :</p>
      <p class="amt"><b>${esc(c.dette)}</b></p>
      <p>${esc(c.words)} **********</p>
      <p>à la Caisse Nationale de Sécurité Sociale au titre des cotisations relatives au
      trimestre <b>${c.q}</b> de l'année <b>${c.year}</b> majoré des pénalités de retard
      prévues par l'article 105 sus visé.</p>
      <p>Décerné par la Caisse Nationale de Sécurité Sociale &nbsp; le &nbsp; <b>${esc(c.date)}</b></p>
    </td>
    <td class="ar" dir="rtl">
      <p>صادرة عن الصندوق الوطني للضمان الاجتماعي عملا بأحكام الفصل 105 من القانون عدد 30
      لسنة 1960 المؤرخ في 14 ديسمبر 1960 مثلما تم تنقيحه وإتمامه بالنصوص اللاحقة.</p>
      <p>من أجل مخالفة أحكام الفصلين 45 و46 من القانون عدد 30 لسنة 1960 والفصل 18 من القانون
      عدد 28 لسنة 1994 المؤرخ في 21 فيفري 1994 ، فإن المؤجر</p>
      <p class="emp"><b>${esc(c.nom)}</b></p>
      <p>المنخرط تحت عدد</p>
      <p>يجبر بجميع الطرق القانونية على دفع ما قدره :</p>
      <p>للصندوق الوطني للضمان الاجتماعي بعنوان اشتراكات عن الثلاثية ${c.q} من سنة ${c.year}
      مع إضافة خطايا التأخير المنصوص عليها بالفصل 105 المشار إليه أعلاه.</p>
      <p>صدرت عن الصندوق الوطني للضمان الاجتماعي &nbsp; في &nbsp; <b>${esc(c.date)}</b></p>
    </td>
  </tr></table>
</section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm; }
  body { font-family: 'Times New Roman', serif; color:#000; font-size: 12px; }
  .card { page-break-after: always; }
  .card:last-child { page-break-after: auto; }
  table { width:100%; border-collapse:collapse; }
  td.fr { width:42%; vertical-align:top; }
  td.ar { width:42%; vertical-align:top; text-align:right; }
  td.logo { width:16%; text-align:center; font-size:42px; vertical-align:middle; }
  .title td { padding-top:18px; font-size:15px; }
  .body td { padding-top:10px; line-height:1.5; }
  .emp { margin-left:30px; }
  .amt { margin-left:40px; font-size:13px; }
  hr { border:0; border-top:1px solid #000; margin:6px 0; }
  p { margin:7px 0; }
</style></head><body>${CARDS.map(cardHtml).join('')}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    const tmp = path.join(os.tmpdir(), `cnss-test-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf8');
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    try {
        await win.loadFile(tmp);
        const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
        fs.mkdirSync(path.dirname(OUT), { recursive: true });
        fs.writeFileSync(OUT, pdf);
        console.log(`Wrote ${CARDS.length}-page test PDF: ${OUT} (${pdf.length} bytes)`);
    } catch (e) {
        console.error('FAILED:', e.message);
        process.exitCode = 1;
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
        app.quit();
    }
});
