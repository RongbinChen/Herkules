import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { storedAttachmentTargets } from '../src/services/visitReportAccess.js';
import { reportToMarkdown } from '../src/services/visitReportExport.js';
import { reportSourceLanguage, sourceLanguage } from '../src/services/visitReport.js';
import {
  buildCaptionPrompt,
  fillEmptyCaptions,
  fitImageForDocx,
  gatherPhotoCandidates,
  imageSize,
  isSkippableReportImage,
  mergeAttachmentUpdate,
  mergeGeneratedPhotos,
  resolveStoredFile,
  retainSavableAttachments,
  sanitizeAttachment,
  sha256,
  visitReportStorageRoot,
  writePhotoFiles,
} from '../src/services/visitReportPhotos.js';

const execFileAsync = promisify(execFile);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

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

// A header logo that is large enough to keep if the importer walked every
// media part, plus a wide letterhead in the body, plus one workshop photo.
function sampleDocx() {
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Visited the roll shop.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><a:blip r:embed="rId10"/></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>The bed was open.</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><a:blip r:embed="rId11"/></w:drawing></w:r></w:p>
  </w:body>
</w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/letterhead.png"/>
  <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/workshop.png"/>
</Relationships>`;
  const headerRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/header-logo.png"/>
</Relationships>`;
  return zip([
    { name: 'word/document.xml', data: Buffer.from(document), deflate: true },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(rels) },
    { name: 'word/_rels/header1.xml.rels', data: Buffer.from(headerRels) },
    { name: 'word/media/header-logo.png', data: png(400, 300, [200, 0, 0]) },
    { name: 'word/media/letterhead.png', data: png(445, 62, [10, 20, 30]), deflate: true },
    { name: 'word/media/workshop.png', data: png(320, 240, [40, 80, 120]) },
  ]);
}

test('letterheads and tiny marks are skipped; workshop photos are kept', () => {
  assert.equal(isSkippableReportImage({ width: 445, height: 62, name: 'header.png' }), true);
  assert.equal(isSkippableReportImage({ width: 40, height: 40 }), true);
  assert.equal(isSkippableReportImage({ width: 80, height: 500, name: 'banner.png' }), true);
  assert.equal(isSkippableReportImage({ name: 'logo.emf', width: 800, height: 600 }), true);
  assert.equal(isSkippableReportImage({ width: 4032, height: 3024 }), false);
  assert.equal(isSkippableReportImage({ width: 800, height: 600 }), false);
  assert.equal(isSkippableReportImage({ width: 2000, height: 400 }), false);
});

test('docx import keeps the workshop photo and drops the header logo and letterhead', () => {
  const { fresh } = gatherPhotoCandidates({ docxBuffer: sampleDocx(), existing: [] });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].name, 'workshop.png');
  assert.equal(fresh[0].width, 320);
  assert.equal(fresh[0].height, 240);
  assert.match(fresh[0].nearby, /roll shop/);
  assert.match(fresh[0].nearby, /bed was open/);
});

test('an uploaded letterhead is not stored, and bytes already on the report are not duplicated', () => {
  const workshop = png(320, 240, [9, 9, 9]);
  const digest = sha256(workshop);
  const banner = png(445, 62, [1, 2, 3]);
  const { fresh, existing } = gatherPhotoCandidates({
    uploads: [
      { name: 'shop.png', mimeType: 'image/png', buffer: workshop },
      { name: 'logo.png', mimeType: 'image/png', buffer: banner },
    ],
    existing: [{
      name: 'shop.png',
      kind: 'image',
      storedName: 'already.png',
      sha256: digest,
      caption: 'User caption',
      captionEdited: true,
    }],
  });
  assert.equal(fresh.length, 0);
  assert.equal(existing[0].caption, 'User caption');
  assert.equal(existing[0].captionEdited, true);
});

test('captions the user edited are not replaced; empty ones can be filled; regenerate is explicit', () => {
  const edited = mergeAttachmentUpdate(
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'User wrote this', captionEdited: true }],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'AI replacement' }],
  );
  assert.equal(edited[0].caption, 'User wrote this');
  assert.equal(edited[0].captionEdited, true);

  const filled = mergeAttachmentUpdate(
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg' }],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'A roll on the grinder' }],
  );
  assert.equal(filled[0].caption, 'A roll on the grinder');
  assert.equal(filled[0].captionEdited, undefined);

  const kept = mergeAttachmentUpdate(
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'Original' }],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'Different draft' }],
  );
  assert.equal(kept[0].caption, 'Original');

  const userSave = mergeAttachmentUpdate(
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'Original' }],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'Changed by the engineer', captionEdited: true }],
  );
  assert.equal(userSave[0].caption, 'Changed by the engineer');
  assert.equal(userSave[0].captionEdited, true);

  const regenerated = mergeAttachmentUpdate(
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'User wrote this', captionEdited: true }],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'Fresh from the photo', regenerateCaption: true }],
  );
  assert.equal(regenerated[0].caption, 'Fresh from the photo');
  assert.equal(regenerated[0].captionEdited, undefined);
  assert.equal(regenerated[0].regenerateCaption, undefined);

  const omitted = mergeAttachmentUpdate(
    [
      { name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'One', captionEdited: true },
      { name: 'b.jpg', kind: 'image', storedName: 'b.jpg', caption: 'Two' },
    ],
    [{ name: 'a.jpg', kind: 'image', storedName: 'a.jpg', caption: 'AI' }],
  );
  assert.equal(omitted.length, 2);
  assert.equal(omitted[1].storedName, 'b.jpg');
  assert.equal(omitted[1].caption, 'Two');
});

test('fillEmptyCaptions leaves edited and non-empty captions alone', () => {
  const filled = fillEmptyCaptions(
    [
      { name: 'a.jpg', kind: 'image', storedName: 'a.jpg', captionEdited: true },
      { name: 'b.jpg', kind: 'image', storedName: 'b.jpg', caption: 'Keep' },
      { name: 'c.jpg', kind: 'image', storedName: 'c.jpg' },
    ],
    new Map([['a.jpg', 'nope'], ['b.jpg', 'nope'], ['c.jpg', 'The open bed']]),
  );
  assert.equal(filled[0].caption, undefined);
  assert.equal(filled[0].captionEdited, true);
  assert.equal(filled[1].caption, 'Keep');
  assert.equal(filled[2].caption, 'The open bed');
});

test('generating again does not overwrite a stored caption when the bytes match', () => {
  const digest = 'ab'.repeat(32);
  const merged = mergeGeneratedPhotos(
    [{ name: 'a.png', kind: 'image', storedName: 'keep.png', sha256: digest, caption: 'User wrote this', captionEdited: true }],
    [{ name: 'a.png', kind: 'image', storedName: 'new.png', sha256: digest, caption: 'AI replacement' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].storedName, 'keep.png');
  assert.equal(merged[0].caption, 'User wrote this');

  const added = mergeGeneratedPhotos(merged, [{
    name: 'b.png',
    kind: 'image',
    storedName: 'second.png',
    sha256: 'cd'.repeat(32),
    caption: 'Second photo',
  }]);
  assert.equal(added.length, 2);
  assert.equal(added[0].caption, 'User wrote this');
  assert.equal(added[1].caption, 'Second photo');
});

test('a stored name cannot escape the storage root, and saved files are the ones delete removes', async () => {
  const escaped = sanitizeAttachment({ name: 'x', storedName: '../outside.png', kind: 'image' });
  assert.equal(escaped.storedName, undefined);
  assert.equal(resolveStoredFile('../outside.png', '/tmp'), null);

  const root = await mkdtemp(path.join(tmpdir(), 'vr-save-'));
  try {
    const buffer = png(320, 240, [4, 5, 6]);
    const [saved] = await writePhotoFiles([{
      name: 'bed.png',
      mimeType: 'image/png',
      buffer,
      caption: 'Bed of the machine',
      width: 320,
      height: 240,
      sha256: sha256(buffer),
    }], root);
    assert.equal(saved.caption, 'Bed of the machine');
    assert.equal(existsSync(path.join(root, saved.storedName)), true);
    assert.deepEqual(storedAttachmentTargets([saved], root), [path.join(root, saved.storedName)]);

    const taken = new Set([saved.storedName]);
    assert.equal(retainSavableAttachments([saved], {
      storageRoot: root,
      takenNames: taken,
      ownedNames: [],
    }), null);
    const owned = retainSavableAttachments([saved], {
      storageRoot: root,
      takenNames: taken,
      ownedNames: [saved.storedName],
    });
    assert.equal(owned[0].storedName, saved.storedName);
    assert.equal(owned[0].caption, 'Bed of the machine');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('markdown puts photos after the summary, sections, and tables', () => {
  const report = {
    title: 'COSCO visit',
    summary: 'They need a grinder.',
    content: {
      needs: 'Capacity is short.',
      tables: [{ title: 'Plan', columns: ['Step'], rows: [['Quote']] }],
    },
  };
  const md = reportToMarkdown(report, {
    photos: [{ caption: 'Bed of the machine ]', markdownPath: 'photo-1.jpg' }],
  });
  const at = md.indexOf('## Report photos');
  assert.ok(at > md.indexOf('## Summary'));
  assert.ok(at > md.indexOf('Capacity is short.'));
  assert.ok(at > md.indexOf('## Plan'));
  assert.ok(at > md.indexOf('Quote'));
  assert.ok(md.indexOf('![') > at);
  assert.match(md, /!\[Bed of the machine\]\(photo-1.jpg\)\{width=14cm\}/);
  assert.equal(reportToMarkdown({ title: 'Empty', content: {} }).includes('Report photos'), false);
  assert.equal(reportToMarkdown(report).includes('## Report photos'), false);
});

test('export images are scaled down instead of embedding the original pixel size', async () => {
  const big = png(1800, 200, [12, 40, 80]);
  const jpeg = await fitImageForDocx(big);
  assert.equal(jpeg[0], 0xff);
  assert.equal(jpeg[1], 0xd8);
  const size = imageSize(jpeg);
  assert.ok(size, 'jpeg size should be readable');
  assert.equal(size.width, 1600);
  assert.ok(size.height < 200);

  const small = imageSize(await fitImageForDocx(png(320, 240, [1, 2, 3])));
  assert.equal(small.width, 320);
  assert.equal(small.height, 240);
});

test('caption language follows the report, and the prompt forbids invented facts', () => {
  assert.equal(sourceLanguage('The customer needs a roll grinder next year.'), 'en');
  assert.equal(sourceLanguage('客户需要一台轧辊磨床，下周再谈方案。'), 'zh');
  assert.equal(reportSourceLanguage({
    title: 'Visit',
    content: { needs: '客户需要一台轧辊磨床，车间里已经有一台旧机床需要评估。' },
  }), 'zh');
  assert.equal(reportSourceLanguage({
    title: 'COSCO visit',
    summary: 'They need a roll grinder before the outage window.',
    content: { needs: 'Capacity is short.' },
  }), 'en');

  const english = buildCaptionPrompt({ language: 'en', context: 'Customer: COSCO' });
  const chinese = buildCaptionPrompt({ language: 'zh', context: 'Customer: 大连重工' });
  assert.match(english, /Write the caption in English/);
  assert.match(chinese, /用中文写说明/);
  assert.match(english, /Do not invent equipment models, serial numbers/);
  assert.match(chinese, /Do not invent equipment models, serial numbers/);
  assert.match(chinese, /大连重工/);
  assert.doesNotMatch(english, /用中文写说明/);
});

test('storage root defaults under backend/data and honors VISIT_REPORT_STORAGE_DIR', () => {
  const prev = process.env.VISIT_REPORT_STORAGE_DIR;
  try {
    delete process.env.VISIT_REPORT_STORAGE_DIR;
    assert.equal(
      visitReportStorageRoot().endsWith(path.join('backend', 'data', 'visit-reports')),
      true,
    );
    process.env.VISIT_REPORT_STORAGE_DIR = path.join(tmpdir(), 'vr-custom');
    assert.equal(visitReportStorageRoot(), path.resolve(process.env.VISIT_REPORT_STORAGE_DIR));
  } finally {
    if (prev === undefined) delete process.env.VISIT_REPORT_STORAGE_DIR;
    else process.env.VISIT_REPORT_STORAGE_DIR = prev;
  }
});

test('pandoc embeds the scaled photo after the report body', async (t) => {
  try {
    await execFileAsync('pandoc', ['-v']);
  } catch {
    t.skip('pandoc is not installed');
    return;
  }

  const work = await mkdtemp(path.join(tmpdir(), 'vr-pandoc-'));
  try {
    const jpeg = await fitImageForDocx(png(900, 600, [30, 60, 90]));
    const size = imageSize(jpeg);
    assert.ok(size.width <= 1600);
    await writeFile(path.join(work, 'photo-1.jpg'), jpeg);
    const md = reportToMarkdown({
      title: 'COSCO visit',
      summary: 'They need a grinder.',
      content: { needs: 'Capacity is short.' },
    }, {
      photos: [{ caption: 'Bed of the machine', markdownPath: 'photo-1.jpg' }],
    });
    await writeFile(path.join(work, 'report.md'), md);
    await execFileAsync('pandoc', ['report.md', '-f', 'markdown', '-t', 'docx', '-o', 'report.docx'], { cwd: work });
    const docx = await readFile(path.join(work, 'report.docx'));
    const entries = (await import('../src/services/visitReportPhotos.js')).unzipSync(docx);
    const media = entries.filter((entry) => entry.name.startsWith('word/media/'));
    assert.equal(media.length, 1);
    const doc = entries.find((entry) => entry.name === 'word/document.xml').data.toString('utf8');
    const photoAt = doc.indexOf('Bed of the machine');
    const summaryAt = doc.indexOf('They need a grinder');
    assert.ok(summaryAt >= 0);
    assert.ok(photoAt > summaryAt);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
