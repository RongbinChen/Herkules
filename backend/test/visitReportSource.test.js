import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import { reportToMarkdown } from '../src/services/visitReportExport.js';
import { targetsFromReply } from '../src/services/visitReport.js';
import { sanitizeAttachment } from '../src/services/visitReportPhotos.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assembleFromDocx,
  assembleOriginalBody,
  assertPreservedContent,
  enrichPreservedPhotos,
  isPreservedBody,
  MAX_ORIGINAL_CHARS,
  parseSourceDate,
  preservedDraft,
  reminderTargets,
  reprocessPreservedFromRawNotes,
  sanitizeOriginalBody,
  sourceMeta,
} from '../src/services/visitReportSource.js';
import { retainSavableAttachments, storedNamesOwnedByOthers } from '../src/services/visitReportPhotos.js';

const execFileAsync = promisify(execFile);

const PHRASES = [
  'X axis driven system is with problem',
  'Beijing No.1 people working on this matter',
  'full hydrostatic, full casted part, sufficient reference',
  'Customer got in general a good impression',
  'non-critical workpiece of their own',
  'changed for table movement',
  '20% downpayment, 70% B/L, 10% FAT',
  'L/C terms',
];

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const payload = file.deflate ? deflateRawSync(file.data) : file.data;
    const method = file.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    local.writeUInt16LE(method, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(file.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    const blob = Buffer.concat([local, name, payload]);
    central.push(Buffer.concat([centralHeader, name]));
    parts.push(blob);
    offset += blob.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function sourceDocx() {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraph('X axis driven system is with problem')}
    ${paragraph('Beijing No.1 people working on this matter')}
    ${paragraph('Customer got in general a good impression')}
    ${paragraph('non-critical workpiece of their own')}
    ${paragraph('changed for table movement')}
    ${paragraph('Payment: 20% downpayment, 70% B/L, 10% FAT')}
    ${paragraph('Settlement by L/C terms')}
    ${paragraph('客户对非关键工件的安排保持原文。')}
    <w:p>
      <w:r><w:t>Visible lead-in.</w:t></w:r>
      <w:r>
        <w:pict>
          <w:txbxContent>${paragraph('full hydrostatic, full casted part, sufficient reference')}</w:txbxContent>
        </w:pict>
      </w:r>
    </w:p>
    ${paragraph('Padding sentence about the shop floor. '.repeat(400))}
    <w:sectPr/>
  </w:body>
</w:document>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(types) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: 'word/document.xml', data: Buffer.from(document), deflate: true },
  ]);
}

test('a text box the markdown missed is appended, and angle brackets stay as text', () => {
  const packed = assembleOriginalBody({
    markdown: 'X axis driven system is with problem\n\n<script>alert(1)</script>Beijing No.1 people working on this matter',
    documentXml: `<w:document><w:body><w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>full hydrostatic, full casted part, sufficient reference</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p></w:body></w:document>`,
  });
  assert.match(packed.originalBody, /full hydrostatic, full casted part, sufficient reference/);
  assert.match(packed.originalBody, /X axis driven system is with problem/);
  assert.match(packed.originalBody, /<script>alert\(1\)<\/script>/);
  assert.ok(packed.warnings.length > 0);
});

test('summary failure and a long source do not change the retained body', () => {
  const long = `${'Shop note. '.repeat(2000)}\nX axis driven system is with problem`;
  assert.ok(long.length > 12000);
  const draft = preservedDraft({
    originalBody: sanitizeOriginalBody(long),
    summary: null,
    summaryError: 'DeepSeek unavailable',
    targets: [],
    targetsError: 'DeepSeek unavailable',
  });
  assert.equal(draft.aiModel, null);
  assert.equal(draft.content.bodySource, 'original');
  assert.equal(draft.content.summaryModel, null);
  assert.equal(draft.content.targetsModel, null);
  assert.equal(draft.content.originalBody, sanitizeOriginalBody(long));
  assert.match(draft.content.originalBody, /X axis driven system is with problem/);
  assert.equal(draft.summary, null);
});

test('target extraction keeps wording and does not become the body', () => {
  const targets = targetsFromReply(JSON.stringify({
    targets: [
      { title: 'X axis driven system is with problem', date: '2026-11-30', note: 'X axis driven system is with problem' },
      { title: 'No date yet', date: 'soon', note: null },
    ],
  }));
  assert.equal(targets[0].title, 'X axis driven system is with problem');
  assert.equal(targets[0].date, '2026-11-30');
  assert.equal(targets[1].date, null);
  assert.equal(targets.length, 2);
});

test('reminders are only the dated targets, and reprocess keeps those targets', () => {
  const content = {
    targets: [
      { title: 'Follow the L/C terms', date: '2026-11-30', note: 'L/C terms' },
      { title: 'No date', date: null, note: 'soon' },
    ],
  };
  assert.equal(reminderTargets(content).length, 1);
  assert.equal(reminderTargets(content)[0].title, 'Follow the L/C terms');

  const raw = PHRASES.join('\n\n');
  const update = reprocessPreservedFromRawNotes({
    rawNotes: raw,
    customerId: 9,
    visitDate: '2026-11-12',
    title: 'Keep me',
    status: 'FINAL',
    attachments: [{ storedName: 'a.jpg', kind: 'image', caption: 'Kept', captionEdited: true }],
    content,
  });
  assert.equal(update.customerId, undefined);
  assert.equal(update.visitDate, undefined);
  assert.equal(update.title, undefined);
  assert.equal(update.status, undefined);
  assert.equal(update.attachments, undefined);
  assert.equal(update.summary, undefined);
  assert.deepEqual(update.content.targets, content.targets);
  for (const phrase of PHRASES) assert.match(update.content.originalBody, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('export prints the retained body and does not add a second structured copy', () => {
  const body = PHRASES.join('\n\n');
  const md = reportToMarkdown({
    title: 'Northline visit',
    summary: 'A separate summary.',
    content: { bodySource: 'original', originalBody: body, needs: 'This rewritten section must not appear', targets: [{ title: 'Follow the L/C terms', date: '2026-11-30' }] },
  }, { photos: [{ caption: 'Shop floor', markdownPath: 'photo-1.jpg' }] });
  const bodyAt = md.indexOf('X axis driven system is with problem');
  assert.ok(bodyAt > md.indexOf('## Summary'));
  assert.ok(md.indexOf('## Report photos') > bodyAt);
  assert.match(md, /20% downpayment, 70% B\/L, 10% FAT/);
  assert.doesNotMatch(md, /This rewritten section must not appear/);
  assert.doesNotMatch(md, /## Customer Needs/);

  const legacy = reportToMarkdown({
    title: 'Older report',
    content: { needs: 'Capacity is short.' },
  });
  assert.match(legacy, /## Customer Needs/);
  assert.equal(isPreservedBody({ needs: 'Capacity is short.' }), false);
});

test('literal angle-bracket notation is kept, and an oversized body is rejected', () => {
  assert.equal(sanitizeOriginalBody('gap <X> and <10 mm>'), 'gap <X> and <10 mm>');
  assert.throws(() => sanitizeOriginalBody('x'.repeat(MAX_ORIGINAL_CHARS + 1)), (err) => err.code === 'BODY_TOO_LARGE');
  assert.throws(
    () => assertPreservedContent({ bodySource: 'original', originalBody: 12 }),
    (err) => err.code === 'BODY_TYPE',
  );
  const kept = assertPreservedContent({ bodySource: 'original', originalBody: 'gap <X>' });
  assert.equal(kept.originalBody, 'gap <X>');
  assert.equal(assertPreservedContent({ needs: 'legacy' }).needs, 'legacy');
});

test('a source date and company are read only when the line is unambiguous', () => {
  const meta = sourceMeta('Date of Visit: 14 July 2026\nCompany: Northline Works\n\nX axis driven system is with problem');
  assert.equal(meta.visitDate, '2026-07-14');
  assert.equal(meta.customerName, 'Northline Works');
  assert.equal(parseSourceDate('07/14/2026'), null);
  assert.equal(sourceMeta('No header here').visitDate, null);
  assert.equal(sourceMeta('No header here').customerName, null);
});

test('reprocess does not replace a preserved body the user has edited', () => {
  const edited = 'Edited body that must stay. X axis driven system is with problem';
  const update = reprocessPreservedFromRawNotes({
    rawNotes: 'Older import source',
    content: {
      bodySource: 'original',
      originalBody: edited,
      targets: [{ title: 'Follow the L/C terms', date: '2026-11-30' }],
    },
  });
  assert.equal(update.applied, false);
  assert.equal(update.reason, 'already-preserved');
  assert.equal(update.content.originalBody, edited);
  assert.equal(update.rawNotes, undefined);
});

test('caption and photo failures do not drop the body or invent a caption', async () => {
  const body = 'X axis driven system is with problem';
  const absent = await enrichPreservedPhotos(
    [{ name: 'a.jpg', buffer: Buffer.from('img') }],
    { geminiConfigured: false, captionImage: async () => 'should not run', writePhoto: async (photo) => ({ storedName: 'a.jpg', caption: photo.caption, kind: 'image' }) },
  );
  assert.equal(absent.photos[0].caption, '');
  assert.equal(absent.warnings[0].code, 'caption-unavailable');

  const rejected = await enrichPreservedPhotos(
    [{ name: 'a.jpg' }],
    { geminiConfigured: true, captionImage: async () => { throw new Error('timeout'); }, writePhoto: async (photo) => ({ storedName: 'a.jpg', caption: photo.caption }) },
  );
  assert.equal(rejected.photos[0].caption, '');
  assert.equal(rejected.warnings[0].code, 'caption-failed');

  const stored = await enrichPreservedPhotos(
    [{ name: 'a.jpg' }],
    { geminiConfigured: true, captionImage: async () => { throw new Error('rejected'); }, writePhoto: async () => { throw new Error('disk'); } },
  );
  assert.equal(stored.photos.length, 0);
  assert.ok(stored.warnings.some((warning) => warning.code === 'photo-not-stored'));
  assert.equal(preservedDraft({ originalBody: body, warnings: stored.warnings, summaryError: 'down', targetsError: 'down' }).content.originalBody, body);
});

test('another report cannot claim this report\'s original Word file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vr-own-'));
  const storedName = '11111111-1111-4111-8111-111111111111.docx';
  try {
    await writeFile(path.join(root, storedName), 'docx-bytes');
    const owner = { id: 1, attachments: [{ name: 'visit.docx', kind: 'document', storedName }] };
    const taken = storedNamesOwnedByOthers([owner], 2);
    assert.equal(taken.has(storedName), true);
    assert.equal(retainSavableAttachments(
      [{ name: 'visit.docx', kind: 'document', storedName }],
      { storageRoot: root, takenNames: taken, ownedNames: [] },
    ), null);
    const kept = retainSavableAttachments(
      [{ name: 'visit.docx', kind: 'document', storedName }],
      { storageRoot: root, takenNames: taken, ownedNames: [storedName] },
    );
    assert.equal(kept[0].kind, 'document');
    assert.equal(kept[0].storedName, storedName);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  const route = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/visitReports.js'), 'utf8');
  const save = route.slice(route.indexOf('router.put'), route.indexOf('router.get(\'/:id/attachments'));
  assert.match(save, /storedAttachmentNames\(existing\.attachments\)/);
  assert.doesNotMatch(save, /imageAttachments\(existing\.attachments\)\.map/);
  const importer = route.slice(route.indexOf('async function respondPreservedImport'), route.indexOf('router.post(\'/generate\''));
  assert.doesNotMatch(importer, /status\(503\)/);
  assert.match(importer, /enrichPreservedPhotos/);
});

test('a stored Word file stays a document, not a photo', () => {
  const doc = sanitizeAttachment({
    name: 'visit.docx',
    kind: 'document',
    storedName: '11111111-1111-1111-1111-111111111111.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.equal(doc.kind, 'document');
  assert.match(doc.storedName, /\.docx$/);
});

test('pandoc keeps paragraphs, and a text box the converter drops is still retained', async (t) => {
  try {
    await execFileAsync('pandoc', ['-v']);
  } catch {
    t.skip('pandoc is not installed');
    return;
  }
  const buffer = sourceDocx();
  const dir = await mkdtemp(path.join(tmpdir(), 'vr-src-'));
  try {
    const inPath = path.join(dir, 'in.docx');
    const outPath = path.join(dir, 'out.md');
    await writeFile(inPath, buffer);
    await execFileAsync('pandoc', [inPath, '-f', 'docx', '-t', 'markdown-raw_html-native_divs-native_spans', '--wrap=none', '-o', outPath]);
    const markdown = await readFile(outPath, 'utf8');
    const packed = assembleFromDocx(buffer, markdown);
    for (const phrase of PHRASES) {
      assert.match(packed.originalBody, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(packed.originalBody, /客户对非关键工件的安排保持原文/);
    assert.ok(packed.originalBody.length > 8000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
