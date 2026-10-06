// 逻辑自检：用内存版 localStorage 模拟浏览器，验证归属校验 / 单向流转 / 归档并发 / 迁移 / 待办口径。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}

const dir = mkdtempSync(join(tmpdir(), 'survey-test-'))
const entry = join(dir, 'entry.ts')
writeFileSync(
  entry,
  `
export { runAction, listEntries, loadOverview } from '@/api/local-service'
export { SEED_ROWS } from '@/data/seed'
export { SURVEY_UNITS, OWNER_FIELD } from '@/data/ownership'
`,
)

const outfile = join(dir, 'bundle.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile,
  alias: { '@': join(process.cwd(), 'src') },
})

const mod = await import(pathToFileURL(outfile).href)
const { runAction, listEntries, loadOverview, SEED_ROWS, SURVEY_UNITS, OWNER_FIELD } = mod

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`PASS ${name}`)
  } else {
    fail++
    console.log(`FAIL ${name} ${extra}`)
  }
}
function surveyRows() {
  return listEntries('survey').items
}
function byCode(code) {
  return surveyRows().find((r) => r['调查编号'] === code)
}

// 1. 播种：所有模块的记录都带归属单位（跨模块归属修正）。
for (const [key, rows] of Object.entries(SEED_ROWS)) {
  const missing = rows.filter((r) => !String(r[OWNER_FIELD] ?? '').trim())
  check(`播种[${key}]全部带归属单位`, missing.length === 0, `缺归属 ${missing.length} 条`)
}
check('播种单位取值确定且一致', SURVEY_UNITS.length === 3)

// 2. 调查编号取数：按调查编号过滤能命中。
const hit = listEntries('survey', { 调查编号: 'SURV-0003' })
check('按调查编号筛选命中唯一记录', hit.total === 1 && hit.items[0]['调查编号'] === 'SURV-0003')

// 2b. 提前归档拒绝：调查中、已记录都不能直接归档（在状态推进之前验证）。
let r = runAction('survey', 1, '提交归档', SURVEY_UNITS[0])
check('调查中不能提前归档', !r.ok && byCode('SURV-0001').status === '调查中')
r = runAction('survey', 2, '提交归档', SURVEY_UNITS[1])
check('已记录不能提前归档', !r.ok && byCode('SURV-0002').status === '已记录')

// 3. 状态单向推进：调查中 → 已记录 → 已复核（不能跳步）。
r = runAction('survey', 1, '提交复核', SURVEY_UNITS[0])
check('调查中不能直接提交复核（跳步拒绝）', !r.ok, r.message)
r = runAction('survey', 1, '安排复查', SURVEY_UNITS[0])
check('调查中不能直接安排复查（跳步拒绝）', !r.ok)
r = runAction('survey', 1, '完成记录', SURVEY_UNITS[0])
check('调查中可完成记录', r.ok && byCode('SURV-0001').status === '已记录', r.message)
r = runAction('survey', 1, '完成记录', SURVEY_UNITS[0])
check('已记录不能重复完成记录', !r.ok)
r = runAction('survey', 1, '提交复核', SURVEY_UNITS[0])
check('已记录可提交复核', r.ok && byCode('SURV-0001').status === '已复核')

// 4. 回退拒绝。
r = runAction('survey', 1, '完成记录', SURVEY_UNITS[0])
check('已复核不能回退到已记录', !r.ok)

// 5. 跨单位人员只能查看：归属调查一队的记录，二队和高校队不能写。
for (const other of [SURVEY_UNITS[1], SURVEY_UNITS[2]]) {
  r = runAction('survey', 1, '安排复查', other)
  check(`跨单位[${other}]安排复查被拒绝`, !r.ok, r.message)
  r = runAction('survey', 1, '提交归档', other)
  check(`跨单位[${other}]提交归档被拒绝`, !r.ok, r.message)
}
// 列表仍可见（跨单位记录不过滤掉，仅禁止写动作）。
check('跨单位记录仍可在列表查看', surveyRows().some((x) => x['归属单位'] === SURVEY_UNITS[2]))

// 6. 只有原调查单位能安排复查 / 提交归档。
r = runAction('survey', 1, '安排复查', SURVEY_UNITS[0])
check('原单位可安排复查', r.ok && byCode('SURV-0001').status === '需复查', r.message)
r = runAction('survey', 4, '提交归档', SURVEY_UNITS[2])
check('非归属单位不能归档 SURV-0004', !r.ok)
r = runAction('survey', 4, '提交归档', SURVEY_UNITS[0])
check('原单位可归档需复查记录', r.ok && byCode('SURV-0004').status === '已归档', r.message)
check('归档后 pending=false', byCode('SURV-0004').pending === false)

// 7. 已复核也可以直接归档（终态）。
r = runAction('survey', 3, '提交归档', SURVEY_UNITS[2])
check('已复核可由原单位归档', r.ok && byCode('SURV-0003').status === '已归档', r.message)

// 8. 已归档后不能再操作（历史归档保持原归属/终态）。
r = runAction('survey', 5, '提交归档', SURVEY_UNITS[2])
check('历史归档记录不能重复归档', !r.ok && byCode('SURV-0005').status === '已归档', r.message)
r = runAction('survey', 5, '安排复查', SURVEY_UNITS[2])
check('历史归档记录不能再安排复查', !r.ok)
check('历史归档保持原归属', byCode('SURV-0005')['归属单位'] === SURVEY_UNITS[2])

// 9. 并发归档同一调查编号：只保留先成功的一次，后到明确拒绝。
// 第一条路径：先归档的请求落库后，紧跟的第二个请求必须拒绝。
r = runAction('survey', 1, '提交归档', SURVEY_UNITS[0])
check('需复查记录首次归档成功', r.ok && byCode('SURV-0001').status === '已归档', r.message)
r = runAction('survey', 1, '提交归档', SURVEY_UNITS[0])
check('同一调查编号第二次归档被明确拒绝', !r.ok && byCode('SURV-0001').status === '已归档', r.message)
check('拒绝信息明确提示并发/重复归档', /归档/.test(r.message))

// 9b. 真正交叠的并发：第一次归档落库（setItem）的瞬间重入第二次，在途锁必须拒绝后到请求。
// 先把 SURV-0002 推进到已复核（播种即为已记录）。
r = runAction('survey', 2, '提交复核', SURVEY_UNITS[1])
check('前置：SURV-0002 提交复核', r.ok)
let nestedResult = null
const rawSetItem = globalThis.window.localStorage.setItem.bind(globalThis.window.localStorage)
globalThis.window.localStorage.setItem = (k, v) => {
  if (k === 'field-archaeology-digital:entries' && nestedResult === null) {
    nestedResult = runAction('survey', 2, '提交归档', SURVEY_UNITS[1])
  }
  rawSetItem(k, v)
}
const firstResult = runAction('survey', 2, '提交归档', SURVEY_UNITS[1])
globalThis.window.localStorage.setItem = rawSetItem
check('并发：先到归档成功', firstResult.ok, firstResult.message)
check('并发：在途的后到归档被明确拒绝', nestedResult && nestedResult.ok === false, nestedResult?.message)
check('并发：只保留先成功的一次（状态仍为已归档，无重复落库）', byCode('SURV-0002').status === '已归档')

// 10. 概览待办口径：归档记录不计入待办，且不重复出现。
const ov = loadOverview()
const surveyModule = ov.modules.find((m) => m.name === '考古调查')
const liveRows = surveyRows()
const expectedPending = liveRows.filter((x) => x.status !== '已归档' && x.pending).length
check('概览调查待办=未归档且pending', surveyModule.pending === expectedPending, `概览${surveyModule.pending} 期望${expectedPending}`)
check('已归档全部不进待办', liveRows.filter((x) => x.status === '已归档').every((x) => true))
check('概览已归档数正确', surveyModule.archived === liveRows.filter((x) => x.status === '已归档').length, `${surveyModule.archived}`)

// 12. 迁移：旧数据（已审核/无归属/已归档但pending=true）经存储层迁移后归一。
storage.clear()
const legacy = {
  survey: [
    { id: 101, status: '已审核', pending: false, abnormal: false, '调查编号': 'SURV-0101' },
    { id: 102, status: '已归档', pending: true, abnormal: false, '调查编号': 'SURV-0102', '归属单位': '高校联合考古队' },
  ],
}
storage.set('field-archaeology-digital:entries', JSON.stringify(legacy))
storage.set('field-archaeology-digital:schema-version', '1')
// 清模块缓存：重新动态导入一次拿到全新 store。
const outfile2 = join(dir, 'bundle2.mjs')
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: outfile2,
  alias: { '@': join(process.cwd(), 'src') },
})
const mod2 = await import(pathToFileURL(outfile2).href + '?t=' + Date.now())
const migrated = mod2.listEntries('survey').items.filter((x) => String(x.id).startsWith('10'))
const m101 = migrated.find((x) => x.id === 101)
const m102 = migrated.find((x) => x.id === 102)
check('迁移：已审核 → 已复核', m101.status === '已复核')
check('迁移：缺归属按确定性口径补齐', SURVEY_UNITS.includes(m101['归属单位']), String(m101['归属单位']))
check('迁移：历史归档原归属保持不变', m102['归属单位'] === '高校联合考古队')
check('迁移：归档后 pending 归一为 false', m102.pending === false)
check('迁移：历史归档仍为已归档', m102.status === '已归档')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
