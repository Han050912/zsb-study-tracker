/** 离场项脱离网格布局前保留宽度，避免淡出时文字突然换行。 */
export function prepareListLeave(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.style.width = `${element.getBoundingClientRect().width}px`
  element.setAttribute('inert', '')
}

export function resetEnteringItem(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.style.width = ''
  element.removeAttribute('inert')
}
