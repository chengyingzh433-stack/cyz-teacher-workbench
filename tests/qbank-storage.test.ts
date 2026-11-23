import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultManager } from '../src/main/vault';
import { AiKeychainStore } from '../src/main/keychain';
import { DEFAULT_PINNED_SPACES } from '../src/shared/types';
import { resolveSafeQbankPath } from '../src/main/question-bank/assets';
import * as contentRepo from '../src/main/question-bank/content';
import * as intakeRepo from '../src/main/question-bank/intake';
import * as bankRepo from '../src/main/question-bank/bank';
import * as basketRepo from '../src/main/question-bank/basket';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Valid minimal 1x1 PNG with width=189, height=224 in IHDR header (for dimension test)
function makeFakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33, 0);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('物理题库 node:sqlite 独立子库：人教版章节树、连续录题继承、版本回滚、NFKC 检索、收藏夹、组卷篮与 Vault 备份', () => {
  const userData = makeTempDir('cyz-qb-ud-');
  const vaultDir = makeTempDir('cyz-qb-vault-');
  const backupDir = makeTempDir('cyz-qb-bak-');
  const vault = new VaultManager(userData);

  try {
    vault.open(vaultDir);
    const qdb = vault.getQbankDb();
    const vpath = vault.getPath();

    // 1. Taxonomy seeded with 人教版高中物理 6 册
    const tax = contentRepo.getTaxonomy(qdb);
    assert.ok(tax.types.length >= 6);
    assert.ok(tax.difficulties.length === 5);
    assert.ok(tax.chapters.length > 100, `Expected >100 PEP physics chapters, got ${tax.chapters.length}`);
    const book1 = tax.chapters.find((c) => c.name === '必修第一册');
    const newtonCh = tax.chapters.find((c) => c.name.includes('第四章 运动和力的关系'));
    assert.ok(book1 && newtonCh);

    // 2. Path traversal guard must block escaping projects/
    assert.throws(() => resolveSafeQbankPath(vpath, '../question-bank.sqlite'), /非法题库路径访问/);
    assert.throws(() => resolveSafeQbankPath(vpath, '../../workbench.sqlite'), /非法题库路径访问/);

    // 3. Continuous intake: import source -> crop small figure -> publish -> verify next draft inherits tags
    const ws = intakeRepo.importIntakeSource(qdb, vpath, {
      name: '26.11.19双周测(试题).pdf',
      kind: 'pdf',
      bytes: Buffer.from('%PDF-1.4\n%test'),
      pageCount: 6,
    });
    assert.equal(ws.drafts.length, 1);

    const fig = intakeRepo.saveIntakeCroppedImage(vpath, ws.source.id, {
      bytes: makeFakePng(189, 224),
      cropWidthRatio: 0.28,
    });
    assert.equal(fig.widthPx, 189);
    assert.equal(fig.heightPx, 224);
    assert.ok(fig.widthPercent >= 20 && fig.widthPercent <= 45, `Small figure widthPercent should be compact, got ${fig.widthPercent}`);

    intakeRepo.updateIntakeDraft(qdb, ws.drafts[0].id, {
      questionBlocks: [
        { id: 'b1', kind: 'text', text: '如图所示，质量为 m 的物块在水平恒力 F 作用下沿光滑斜面加速运动。' },
        {
          id: 'b2',
          kind: 'image',
          relPath: fig.relPath,
          widthPx: fig.widthPx,
          heightPx: fig.heightPx,
          widthPercent: fig.widthPercent,
          caption: '受力示意图',
        },
      ],
      answerBlocks: [{ id: 'a1', kind: 'text', text: '由牛顿第二定律 F = ma 可得加速度大小。' }],
      metadata: {
        typeId: tax.types[0].id,
        chapterId: newtonCh.id,
        difficultyId: tax.difficulties[2].id,
        knowledgePointIds: [tax.knowledgePoints[0].id],
        year: 2026,
        source: '高三物理双周测',
      },
    });

    const pub = intakeRepo.publishIntakeDraft(qdb, vpath, ws.drafts[0].id);
    assert.ok(pub.questionId > 0);
    assert.equal(pub.nextDraft.status, 'draft');
    assert.equal(pub.nextDraft.metadata.chapterId, newtonCh.id);
    assert.equal(pub.nextDraft.metadata.source, '高三物理双周测');

    // 4. Edit + append-only revision history + rollback
    const editable1 = contentRepo.getEditableQuestion(qdb, pub.questionId);
    assert.equal(editable1.content.revision, 1);
    assert.equal(editable1.assets.length, 1);

    const editable2 = contentRepo.saveQuestionEdits(qdb, pub.questionId, {
      expectedRevision: 1,
      metadata: editable1.metadata,
      content: {
        ...editable1.content,
        questionBody: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '修订版题干：合力满足 ' },
                { type: 'inlineMath', attrs: { latex: 'F = ma' } },
              ],
            },
          ],
        },
      },
    });
    assert.equal(editable2.content.revision, 2);

    const revs = contentRepo.listContentRevisions(qdb, pub.questionId);
    assert.deepEqual(revs.map((r) => r.revision), [2, 1]);

    const restored = contentRepo.restoreContentRevision(qdb, pub.questionId, 1);
    assert.equal(restored.content.revision, 3);
    assert.match(restored.question.previewText, /光滑斜面/);

    // 5. NFKC full-text search + recursive chapter subtree search + folders
    const hitByText = bankRepo.searchBankQuestions(qdb, { query: '光滑斜面' });
    assert.equal(hitByText.length, 1);
    assert.ok(hitByText[0].snippet?.includes('光滑斜面'));

    // Filtering by parent book ("必修第一册") must match question tagged under child chapter ("第四章")
    const hitByBook = bankRepo.searchBankQuestions(qdb, { chapterId: book1.id });
    assert.equal(hitByBook.length, 1);

    const folder = bankRepo.createFolder(qdb, '双周测压轴');
    bankRepo.setQuestionFolderMembership(qdb, folder.id, pub.questionId, true);
    const hitByFolder = bankRepo.searchBankQuestions(qdb, { folderId: folder.id });
    assert.equal(hitByFolder.length, 1);

    // 6. Basket ordering & group headers
    const sets = basketRepo.listPaperSets(qdb);
    assert.ok(sets.length >= 1);
    const q2 = bankRepo.createManualQuestion(qdb, { questionText: '第二道手动录入物理题：动能定理应用' });
    basketRepo.addToPaperSet(qdb, sets[0].id, pub.questionId);
    let detail = basketRepo.addToPaperSet(qdb, sets[0].id, q2.id);
    assert.equal(detail.items.length, 2);
    detail = basketRepo.reorderPaperSetItems(qdb, sets[0].id, [detail.items[1].id, detail.items[0].id]);
    assert.equal(detail.items[0].questionId, q2.id);
    detail = basketRepo.updatePaperSetItem(qdb, detail.items[0].id, {
      displayNumber: '1',
      groupHeader: '一、单项选择题',
    });
    assert.equal(detail.items[0].groupHeader, '一、单项选择题');

    // 7. Vault info & full snapshot backup include question-bank/
    const info = vault.getInfo();
    assert.equal(info.qbankQuestionCount, 2);
    assert.ok(info.qbankBytes > 0);
    const exportedDir = vault.exportCopyTo(backupDir);
    assert.ok(fs.existsSync(path.join(exportedDir, 'question-bank', 'question-bank.sqlite')));
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('Apps Hub 侧边栏置顶偏好持久化 & Doc2X 密钥加密绝不进 Vault', () => {
  const userData = makeTempDir('cyz-pref-ud-');
  const vaultDir = makeTempDir('cyz-pref-vault-');
  try {
    // 1. Legacy preferences.json without pinnedSpaces gracefully defaults to all 6
    fs.writeFileSync(
      path.join(userData, 'preferences.json'),
      JSON.stringify({ themeId: 'studio-light', vaultPath: vaultDir, sidebarCollapsed: false, recentVaults: [] }),
    );
    const vm1 = new VaultManager(userData);
    assert.deepEqual(vm1.getPreferences().pinnedSpaces, DEFAULT_PINNED_SPACES);

    vm1.updatePreferences({ pinnedSpaces: ['classroom', 'qbank'] });
    const vm2 = new VaultManager(userData);
    assert.deepEqual(vm2.getPreferences().pinnedSpaces, ['classroom', 'qbank']);

    // 2. Doc2X key encrypted in userData ai-config.json (sync safeStorage only), never in Vault
    let asyncCalled = false;
    const mockSafeStorage = {
      isEncryptionAvailable: () => true,
      isAsyncEncryptionAvailable: async () => {
        asyncCalled = true;
        return true;
      },
      encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf8'),
      decryptString: (buf: Buffer) => buf.toString('utf8').replace(/^enc:/, ''),
    };
    const store = new AiKeychainStore(userData, mockSafeStorage);
    const view = store.save({ doc2x: { enabled: true, key: 'sk-doc2x-secret-test' } });
    assert.equal(view.doc2x.enabled, true);
    assert.equal(view.doc2x.hasKey, true);
    assert.equal(view.doc2x.ready, true);
    assert.equal(asyncCalled, false, 'Passive/save keychain ops must NEVER call isAsyncEncryptionAvailable');
    const rawDisk = fs.readFileSync(path.join(userData, 'ai-config.json'), 'utf8');
    assert.ok(!rawDisk.includes('sk-doc2x-secret-test'), 'Doc2X API key must not be stored in plaintext');
    assert.equal(store.resolveDoc2x().key, 'sk-doc2x-secret-test');
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }
});
