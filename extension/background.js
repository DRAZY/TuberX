// TuberX browser extension — hands URLs to the desktop app through the tuberx:// protocol.
// Works in Chrome, Edge (chrome.*) and Firefox (browser.* is aliased below).
const api = typeof browser !== 'undefined' ? browser : chrome

function deepLink(url, later) {
  return `${later ? 'tuberxlater' : 'tuberx'}://${url}`
}

/** Navigate a throwaway tab to the protocol URL so the OS launches TuberX, then close it. */
async function send(url, later) {
  if (!url || !/^https?:\/\//i.test(url)) return
  const tab = await api.tabs.create({ url: deepLink(url, later), active: false })
  setTimeout(() => api.tabs.remove(tab.id).catch(() => {}), 1500)
}

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({ id: 'tx-link', title: 'Send link to TuberX', contexts: ['link', 'video', 'audio'] })
  api.contextMenus.create({ id: 'tx-link-later', title: 'Add link to TuberX Later', contexts: ['link', 'video', 'audio'] })
  api.contextMenus.create({ id: 'tx-page', title: 'Send this page to TuberX', contexts: ['page'] })
  api.contextMenus.create({ id: 'tx-page-later', title: 'Add this page to TuberX Later', contexts: ['page'] })
})

api.contextMenus.onClicked.addListener((info, tab) => {
  const target = info.linkUrl || info.srcUrl || info.pageUrl || tab?.url
  const later = info.menuItemId.endsWith('-later')
  void send(target, later)
})

api.action.onClicked.addListener((tab) => void send(tab.url, false))

api.commands.onCommand.addListener(async (command) => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  if (command === 'send-to-tuberx') void send(tab.url, false)
  if (command === 'send-to-tuberx-later') void send(tab.url, true)
})
