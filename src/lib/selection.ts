import { ref } from 'vue'

/**
 * Click-to-select for a list of ids: plain click selects one, Cmd/Ctrl/Shift-click toggles, select all, clear,
 * and pruning when the list changes. Shared by the History and Download Later drawers (the queue has its own).
 */
export function useSelection() {
  const selected = ref(new Set<string>())
  const isSelected = (id: string) => selected.value.has(id)
  function toggle(id: string): void {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }
  function click(id: string, e: MouseEvent): void {
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, select, textarea')) return
    if (e.metaKey || e.ctrlKey || e.shiftKey) toggle(id)
    else selected.value = new Set([id])
  }
  function selectAll(ids: string[]): void {
    selected.value = new Set(ids)
  }
  function clear(): void {
    selected.value = new Set()
  }
  /** Drop ids that no longer exist. */
  function prune(ids: string[]): void {
    const live = new Set(ids)
    const next = new Set([...selected.value].filter((id) => live.has(id)))
    if (next.size !== selected.value.size) selected.value = next
  }
  return { selected, isSelected, toggle, click, selectAll, clear, prune }
}
