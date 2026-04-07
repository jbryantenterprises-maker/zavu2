import './style.css'
import { ZavuApp } from './app.js'
import { ModalHelpers } from './modal-helpers.js'

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new ZavuApp()
  
  // Make app methods available globally for onclick handlers
  ;(window as any).app = app
  
  // Bind individual methods to window for compatibility with existing HTML
  const methods = [
    'startSending',
    'pasteLink', 
    'handleFileSelect',
    'handleDrop',
    'handleDragOver',
    'handleDragLeave',
    'clearFile',
    'createP2PLink',
    'copyLink',
    'emailLink',
    'showQR',
    'hideQR',
    'cancelTransfer',
    'startDownload'
  ]
  
  methods.forEach(method => {
    ;(window as any)[method] = app[method as keyof ZavuApp].bind(app)
  })

  // Bind modal helper methods
  ;(window as any).showHowItWorks = ModalHelpers.showHowItWorks.bind(ModalHelpers)
  ;(window as any).hideHowItWorks = ModalHelpers.hideHowItWorks.bind(ModalHelpers)
  ;(window as any).copyCodeToClipboard = ModalHelpers.copyCodeToClipboard.bind(ModalHelpers)
  
  console.log('%cZavu v2.0 — Vite + TypeScript P2P File Transfer', 'background:#00ff9d;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px')
  console.log('No central storage. Pure peer-to-peer over WebRTC. Privacy first.')
})
