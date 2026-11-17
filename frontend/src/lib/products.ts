// Продукты сделок: базовый список (seed) + динамический DISTINCT из БД.

export interface ProductOption {
  value: string
  label: string
  color: string
}

// Базовый список продуктов (seed). Новые продукты видны сразу,
// даже если сделок с ними ещё нет.
const SEED_PRODUCTS: ProductOption[] = [
  { value: "М-Быстрый старт", label: "М-Быстрый старт", color: "#6366f1" },
  { value: "Ж-Быстрый старт", label: "Ж-Быстрый старт", color: "#ec4899" },
  { value: "Терапия", label: "Терапия", color: "#22c55e" },
  { value: "ЖП", label: "ЖП", color: "#a855f7" },
  { value: "Диагностика", label: "Диагностика", color: "#f97316" },
  { value: "Обуч. оргазмы", label: "Обуч. оргазмы", color: "#06b6d4" },
  { value: "МК оргазмы онлайн", label: "МК оргазмы онлайн", color: "#0ea5e9" },
  { value: "МК оргазмы оффлайн", label: "МК оргазмы оффлайн", color: "#8b5cf6" },
  { value: "Знакомство", label: "Знакомство", color: "#14b8a6" },
]

// Палитра цветов для продуктов, которых нет в seed (приходят из БД).
const PRODUCT_COLORS = ["#6366f1", "#ec4899", "#22c55e", "#a855f7", "#f97316", "#06b6d4", "#0ea5e9", "#8b5cf6", "#14b8a6", "#eab308"]

// Объединяет seed-список с уникальными продуктами из БД, сохраняя порядок seed первым.
export function buildProductOptions(dbProducts: string[]): ProductOption[] {
  const byValue = new Map(SEED_PRODUCTS.map((p) => [p.value, p]))
  const extra = dbProducts.filter((p) => !byValue.has(p))
  extra.forEach((p, i) => byValue.set(p, { value: p, label: p, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }))
  return Array.from(byValue.values())
}
