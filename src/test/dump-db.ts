import Dexie from 'dexie'

export interface DumpDbOptions {
  tables?: string[]
}

export async function dumpDb(db: Dexie, options: DumpDbOptions = {}): Promise<string> {
  const tableNames = (options.tables ?? db.tables.map((t) => t.name)).slice().sort()
  const lines: string[] = []
  for (const name of tableNames) {
    let table
    try {
      table = db.table(name)
    } catch {
      lines.push(`# ${name}: (table not found)`)
      continue
    }
    const rows = await table.toArray()
    lines.push(`# ${name} (${rows.length})`)
    for (const row of rows) {
      lines.push(stableStringify(row))
    }
  }
  return lines.join('\n')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(sortDeep)
  if (typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortDeep(obj[key])
  }
  return out
}
