import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
}
globalThis.__backup = { user: { value: { id: 'source' } } }
const result = await build({
  stdin: {
    contents: `export * from './src/stores/app/importExport';
    export * from './src/data/defaults'; export * from './src/utils/session';
    export { prepareBackupRestore, serializeCompleteBackup } from './src/services/completeBackup';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  define: { __DESKTOP_BUILD__: 'false', 'import.meta.env': '{"VITE_API_BASE":"https://test.invalid"}' },
  plugins: [
    {
      name: 'backup-isolated-boundaries',
      setup(builder) {
        builder.onResolve(
          { filter: /(?:services\/(?:auth|noteBodies|onboarding|syncOutbox)|api\/(?:pdfs|errorImages)|^\.\/staging)$/ },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('/auth')) return { contents: 'export const sessionUser = globalThis.__backup.user;' }
          if (path.endsWith('/pdfs'))
            return {
              contents: `export const PDF_MAX_BYTES = 30 * 1024 * 1024;
          export const fetchPdf = (...args) => globalThis.__backup.readPdf(...args);
          export const uploadPdf = (...args) => globalThis.__backup.uploadPdf(...args);
          export const deletePdf = (...args) => globalThis.__backup.deletePdf(...args);`
            }
          if (path.endsWith('/errorImages'))
            return {
              contents: `
          export const fetchErrorImage = (...args) => globalThis.__backup.readImage(...args);
          export const uploadErrorImage = (...args) => globalThis.__backup.uploadImage(...args);`
            }
          if (path.endsWith('/noteBodies'))
            return {
              contents: `
          export const noteConflicts = { get value() { return globalThis.__backup.conflicts } };
          export const exportNoteBody = (...args) => globalThis.__backup.readBody(...args);
          export const getNoteBody = id => globalThis.__backup.bodies().get(id)?.content ?? '';
          export const queueNoteBody = (id, content, updatedAt) => globalThis.__backup.bodies().set(id, { content, updatedAt });
          export const clearAllNoteBodies = () => {};`
            }
          if (path.endsWith('/onboarding')) return { contents: 'export const restoreOnboarding = () => {};' }
          if (path.endsWith('/syncOutbox'))
            return {
              contents: `export const stagePoints = () => {}; export const stageAchievements = () => {};
              export const takeForFlush = () => globalThis.__backup.pending;`
            }
          return {
            contents: `export const stageAllDeletes = () => globalThis.__backup.deletions++;
          export const stageAllUpserts = () => {}; export const touchRecord = () => {};`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/backup-tests', { recursive: true })
const filename = resolve('.cache/backup-tests', `${crypto.randomUUID()}.mjs`)
await writeFile(filename, result.outputFiles[0].text)
after(() => unlink(filename))
const app = await import(pathToFileURL(filename).href)
const pdf = new TextEncoder().encode('%PDF-1.4\noriginal isolated PDF\n%%EOF')
const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
)
const sha = async (bytes) => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
const imageId = await sha(png)
let fixture

function switchAccount(id) {
  fixture.user.value = { id }
  app.markSessionActive(id)
}

beforeEach(() => {
  storage.clear()
  const accounts = new Map()
  const account = () => {
    const id = fixture.user.value.id
    if (!accounts.has(id)) accounts.set(id, { pdfs: new Map(), images: new Map(), bodies: new Map() })
    return accounts.get(id)
  }
  fixture = Object.assign(globalThis.__backup, {
    accounts,
    deletions: 0,
    uploads: [],
    cleaned: [],
    conflicts: [],
    pending: null,
    bodies: () => account().bodies,
    readPdf: async (id) => {
      const value = account().pdfs.get(id)
      if (!value) throw new Error('PDF 文件不存在')
      return value
    },
    readImage: async (id) => {
      const value = account().images.get(id)
      if (!value) throw new Error('错题图片不存在')
      return new Blob([value], { type: 'image/png' })
    },
    readBody: async (note) => {
      const value = account().bodies.get(note.id)
      if (!value) throw new Error('笔记正文未能读取')
      return value
    },
    uploadPdf: async (id, file) => {
      fixture.uploads.push(['pdf', fixture.user.value.id, id])
      account().pdfs.set(id, new Uint8Array(await file.arrayBuffer()))
    },
    uploadImage: async (bytes) => {
      const id = await sha(bytes)
      fixture.uploads.push(['image', fixture.user.value.id, id])
      account().images.set(id, new Uint8Array(bytes))
      return id
    },
    deletePdf: async (id) => {
      fixture.cleaned.push(id)
      account().pdfs.delete(id)
    }
  })
  switchAccount('source')
})

function storeOf(data = app.createDefaultState()) {
  const store = Object.assign({}, data, app.importExportActions, {
    save() {},
    saveAsync: async () => true,
    $patch(patch) {
      Object.assign(this, patch)
    }
  })
  const fields = Object.keys(app.createDefaultState())
  Object.defineProperty(store, '$state', { get: () => Object.fromEntries(fields.map((key) => [key, store[key]])) })
  return store
}

function populate() {
  const data = app.createDefaultState()
  data.notes = [
    { id: 'pdfnote', subjectId: 'math', title: 'PDF', tags: [], type: 'pdf', updatedAt: 100, bodyUpdatedAt: 0 },
    { id: 'textnote', subjectId: 'math', title: '文字', tags: [], updatedAt: 100, bodyUpdatedAt: 100 }
  ]
  data.errorQuestions = ['q1', 'q2'].map((id) => ({
    id,
    subjectId: 'math',
    date: '2026-10-10',
    type: 'choice',
    content: '一道错题',
    reviewCount: 1,
    mastered: false,
    lastReviewResult: 'hard',
    reviewStreak: 0,
    createdAt: 100,
    image: `r2:${imageId}`
  }))
  fixture.bodies().set('textnote', { content: '保留公式 $x^2$ 和文字', updatedAt: 100 })
  fixture.accounts.get('source').pdfs.set('pdfnote', pdf)
  fixture.accounts.get('source').images.set(imageId, png)
  return storeOf(data)
}

test('export → empty independent account restore preserves text, PDF bytes, and deduplicated image bytes', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  const backup = JSON.parse(raw)
  assert.equal(backup.attachments.length, 2)
  switchAccount('destination')
  const destination = storeOf()
  const snapshots = []
  assert.equal(await destination.restoreBackup(raw, (json) => snapshots.push(JSON.parse(json))), true)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].format, 'zsb-study-backup')
  assert.equal(snapshots[0].data.notes.length, 0)
  const restoredPdf = destination.notes.find((note) => note.type === 'pdf')
  assert.notEqual(restoredPdf.id, 'pdfnote')
  assert.deepEqual(await fixture.readPdf(restoredPdf.id), pdf)
  assert.equal(fixture.bodies().get('textnote').content, '保留公式 $x^2$ 和文字')
  assert.deepEqual(new Uint8Array(await (await fixture.readImage(imageId)).arrayBuffer()), png)
  assert.equal(destination.errorQuestions[0].lastReviewResult, 'hard')
  assert.ok(fixture.uploads.every(([, account]) => account === 'destination'))
  assert.deepEqual(fixture.accounts.get('source').pdfs.get('pdfnote'), pdf)
  const exportedAgain = JSON.parse(await destination.exportCompleteBackup())
  assert.equal(exportedAgain.attachments.length, 2)
  assert.equal(exportedAgain.data.noteBodies.textnote.content, backup.data.noteBodies.textnote.content)
})

test('automatic snapshot includes current PDF and text before replacement starts', async () => {
  const source = populate()
  const original = JSON.stringify(source.$state)
  const blank = JSON.stringify(app.createDefaultState())
  let snapshot
  assert.equal(
    await source.restoreBackup(blank, (raw) => {
      snapshot = JSON.parse(raw)
      assert.equal(JSON.stringify(source.$state), original)
      assert.equal(fixture.deletions, 0)
    }),
    true
  )
  assert.equal(snapshot.attachments.length, 2)
  assert.equal(snapshot.data.noteBodies.textnote.content, '保留公式 $x^2$ 和文字')
  assert.equal(source.notes.length, 0)
})

for (const kind of ['pdf', 'image', 'body']) {
  test(`missing ${kind} stops complete export and snapshot preparation without replacing data`, async () => {
    const source = populate()
    const before = JSON.stringify(source.$state)
    if (kind === 'pdf') fixture.accounts.get('source').pdfs.clear()
    if (kind === 'image') fixture.accounts.get('source').images.clear()
    if (kind === 'body') fixture.bodies().clear()
    await assert.rejects(source.exportCompleteBackup())
    await assert.rejects(
      source.restoreBackup(JSON.stringify(app.createDefaultState()), () => assert.fail('no snapshot'))
    )
    assert.equal(JSON.stringify(source.$state), before)
    assert.equal(fixture.deletions, 0)
    assert.equal(fixture.uploads.length, 0)
  })
}

test('invalid digests, sizes, MIME types, missing and extra references fail before snapshot or upload', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  const mutations = [
    (b) => {
      b.attachments[0].sha256 = '0'.repeat(64)
    },
    (b) => {
      b.attachments[0].size++
    },
    (b) => {
      b.attachments[0].mediaType = 'image/png'
    },
    (b) => {
      b.attachments[0].base64 = '!invalid'
    },
    (b) => {
      b.attachments.pop()
    },
    (b) => {
      b.attachments.push(b.attachments[0])
    },
    (b) => {
      b.attachments[0].id = 'missingnote'
    },
    (b) => {
      delete b.data.noteBodies.textnote
    },
    (b) => {
      b.attachments[0].size = 129 * 1024 * 1024
    },
    (b) => {
      b.data.errorQuestions[0].image = 'r2:' + '0'.repeat(64)
    },
    (b) => {
      b.data.todos = [{ id: 'todo', date: '2026-10-10', text: 't', done: false, order: 0, subjectId: 42 }]
    },
    (b) => {
      b.data.errorQuestions[0].reviewStreak = -1
    }
  ]
  for (const mutate of mutations) {
    const invalid = JSON.parse(raw)
    mutate(invalid)
    await assert.rejects(source.restoreBackup(JSON.stringify(invalid), () => assert.fail('no snapshot')))
    assert.equal(fixture.deletions, 0)
    assert.equal(fixture.uploads.length, 0)
  }
})

test('attachment upload failure cleans new PDF and leaves existing data and bytes untouched', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  const before = JSON.stringify(source.$state)
  fixture.uploadImage = async () => {
    throw new Error('upload offline')
  }
  await assert.rejects(
    source.restoreBackup(raw, () => {}),
    /upload offline/
  )
  assert.equal(JSON.stringify(source.$state), before)
  assert.equal(fixture.deletions, 0)
  assert.equal(fixture.cleaned.length, 1)
  assert.notEqual(fixture.cleaned[0], 'pdfnote')
  assert.deepEqual(await fixture.readPdf('pdfnote'), pdf)
})

test('switching accounts during upload never commits private data or cleans files in the next account', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  const before = JSON.stringify(source.$state)
  const originalUpload = fixture.uploadPdf
  fixture.uploadPdf = async (...args) => {
    await originalUpload(...args)
    switchAccount('other')
  }
  await assert.rejects(
    source.restoreBackup(raw, () => {}),
    /登录账号已改变/
  )
  assert.equal(JSON.stringify(source.$state), before)
  assert.equal(fixture.deletions, 0)
  assert.equal(fixture.cleaned.length, 0)
  assert.equal(fixture.uploads.length, 1)
})

test('legacy inline pictures are packed as bytes and old JSON remains importable', async () => {
  const source = populate()
  source.errorQuestions[0].image = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
  const packed = JSON.parse(await source.exportCompleteBackup())
  assert.equal(packed.data.errorQuestions[0].image, `r2:${imageId}`)
  assert.equal(packed.attachments.length, 2)
  const legacy = JSON.stringify({
    ...app.createDefaultState(),
    settings: { ...app.createDefaultState().settings, autoUpdateCheck: false }
  })
  assert.equal((await app.parseBackupFile(legacy)).complete, null)
  assert.equal(source.importJSON(legacy), true)
  assert.equal(source.settings.autoUpdateCheck, false)
})

test('complete export retains local conflict text as an independent restorable note', async () => {
  const source = populate()
  fixture.conflicts = [
    {
      id: 'conflict-a',
      noteId: 'textnote',
      content: '本机被替换的版本\n不能丢',
      updatedAt: 90,
      createdAt: 120,
      persisted: false
    }
  ]
  const raw = await source.exportCompleteBackup()
  const exported = JSON.parse(raw)
  const copy = exported.data.notes.find((note) => note.tags.includes('冲突恢复'))
  assert.ok(copy)
  assert.notEqual(copy.id, 'textnote')
  assert.equal(exported.data.noteBodies[copy.id].content, fixture.conflicts[0].content)
  switchAccount('destination')
  fixture.conflicts = []
  const destination = storeOf()
  assert.equal(await destination.restoreBackup(raw, () => {}), true)
  assert.equal(fixture.bodies().get(copy.id).content, '本机被替换的版本\n不能丢')
})

test('restore waits for previous sync and stops before snapshot or attachments if that sync fails', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  let resolveSync, signalStarted
  const started = new Promise((resolve) => {
    signalStarted = resolve
  })
  source.saveAsync = () =>
    new Promise((resolve) => {
      resolveSync = resolve
      signalStarted()
    })
  const flight = source.restoreBackup(raw, () => assert.fail('snapshot must follow successful drain'))
  await started
  assert.equal(fixture.uploads.length, 0)
  assert.equal(fixture.deletions, 0)
  resolveSync(false)
  await assert.rejects(flight, /当前修改尚未完成同步/)
  assert.equal(fixture.uploads.length, 0)
})

test('export file limit includes UTF-8 text and base64, and accepts the exact boundary', () => {
  const backup = {
    format: 'zsb-study-backup',
    version: 2,
    createdAt: 1,
    data: { text: '中文正文'.repeat(5) },
    attachments: []
  }
  const bytes = new Blob([JSON.stringify(backup)]).size
  assert.equal(app.serializeCompleteBackup(backup, bytes), JSON.stringify(backup))
  assert.throws(() => app.serializeCompleteBackup(backup, bytes - 1), /文件上限/)
})

test('reselecting the original complete backup repairs missing queued images before sync and snapshot', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  fixture.accounts.get('source').images.delete(imageId)
  fixture.pending = {
    upserts: {
      errorQuestions: { [source.errorQuestions[0].id]: { restoration: true, value: { image: `r2:${imageId}` } } }
    }
  }
  let calls = 0
  source.saveAsync = async () => {
    calls++
    return fixture.accounts.get('source').images.has(imageId)
  }
  let snapshots = 0
  assert.equal(
    await source.restoreBackup(raw, () => {
      snapshots++
      assert.equal(calls, 2, 'missing ownership repaired before draining and snapshot')
      assert.equal(fixture.uploads.filter(([kind]) => kind === 'image').length, 1)
    }),
    true
  )
  assert.equal(snapshots, 1)
  assert.equal(fixture.deletions, 1)
  assert.deepEqual(new Uint8Array(await (await fixture.readImage(imageId)).arrayBuffer()), png)
})

test('a different backup cannot bypass unresolved restoration image dependencies', async () => {
  const source = populate()
  const raw = await source.exportCompleteBackup()
  fixture.pending = {
    upserts: { errorQuestions: { restored: { restoration: true, value: { image: `r2:${'f'.repeat(64)}` } } } }
  }
  source.saveAsync = async () => false
  await assert.rejects(
    source.restoreBackup(raw, () => assert.fail('no new snapshot')),
    /选择上次恢复使用的完整备份/
  )
  assert.equal(fixture.uploads.length, 0)
  assert.equal(fixture.deletions, 0)
})

test('image repair matches the original question when metadata stripping changed the image hash', async () => {
  const source = populate()
  const original = new Uint8Array([...png, 1, 2, 3])
  for (const question of source.errorQuestions) {
    question.image = `data:image/png;base64,${Buffer.from(original).toString('base64')}`
  }
  const raw = await source.exportCompleteBackup()
  const originalImageId = JSON.parse(raw).attachments.find((attachment) => attachment.kind === 'error-image').id
  assert.notEqual(originalImageId, imageId)
  for (const question of source.errorQuestions) question.image = `r2:${imageId}`
  fixture.accounts.get('source').images.delete(imageId)
  fixture.pending = {
    upserts: {
      errorQuestions: { [source.errorQuestions[0].id]: { restoration: true, value: { image: `r2:${imageId}` } } }
    }
  }
  fixture.uploadImage = async () => {
    fixture.accounts.get('source').images.set(imageId, png)
    return imageId
  }
  source.saveAsync = async () => fixture.accounts.get('source').images.has(imageId)
  assert.equal(await source.restoreBackup(raw, () => {}), true)
  assert.ok(source.errorQuestions.every((question) => question.image === `r2:${imageId}`))
})

test('rate-limited restore waits and resumes its current image, preserving the first twenty uploads', async () => {
  const data = app.createDefaultState()
  const attachments = Array.from({ length: 23 }, (_, i) => ({
    kind: 'error-image',
    id: String(i).padStart(64, '0'),
    base64: Buffer.from(png).toString('base64'),
    size: png.length,
    sha256: imageId,
    mediaType: 'image/png'
  }))
  const backup = { format: 'zsb-study-backup', version: 2, data, createdAt: 1, attachments }
  let calls = 0,
    quota = 0,
    waits = 0
  const progress = []
  await app.prepareBackupRestore(backup, {
    newPdfId: () => 'newpdf',
    uploadPdf: async () => {},
    deletePdf: async () => {},
    assertCurrent() {},
    uploadImage: async () => {
      calls++
      if (++quota > 20) throw Object.assign(new Error('限流'), { status: 429 })
      return imageId
    },
    wait: async (ms) => {
      assert.equal(ms, 61_000)
      waits++
      quota = 0
    },
    progress: (message) => progress.push(message)
  })
  assert.equal(calls, 24, 'only the blocked image is retried')
  assert.equal(waits, 1)
  assert.ok(progress.some((message) => message.includes('20/23') && message.includes('限流')))
})

test('account change during a rate-limit wait prevents further uploads and cleanup under the new account', async () => {
  let active = true,
    calls = 0
  await assert.rejects(
    app.prepareBackupRestore(
      {
        data: app.createDefaultState(),
        attachments: [{ kind: 'error-image', id: imageId, base64: Buffer.from(png).toString('base64') }]
      },
      {
        newPdfId: () => 'newpdf',
        uploadPdf: async () => {},
        deletePdf: async () => assert.fail('wrong-account cleanup'),
        assertCurrent() {
          if (!active) throw new Error('账号已改变')
        },
        uploadImage: async () => {
          calls++
          throw Object.assign(new Error('限流'), { status: 429 })
        },
        wait: async () => {
          active = false
        }
      }
    ),
    /账号已改变/
  )
  assert.equal(calls, 1)
})
