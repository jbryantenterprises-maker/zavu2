import './style.css'
import { XavuApp } from './app.js'
import { ModalHelpers } from './modal-helpers.js'

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new XavuApp()

  bindUI(app)
  
  console.log('%cXavu v2.0 — Vite + TypeScript P2P File Transfer', 'background:#00ff9d;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px')
  console.log('No central storage. Pure peer-to-peer over WebRTC. Privacy first.')
})

function bindUI(app: XavuApp) {
  bindClick('how-it-works-link', (event) => {
    event.preventDefault()
    ModalHelpers.showHowItWorks()
  })
  bindClick('copy-code-link', (event) => {
    event.preventDefault()
    ModalHelpers.copyCodeToClipboard()
  })
  bindClick('auth-btn', () => app.handleAuthClick())
  bindClick('upgrade-btn', () => app.checkoutPro())
  bindClick('start-sending-btn', () => app.startSending())
  bindClick('paste-link-btn', () => app.pasteLink())
  bindClick('cancel-transfer-btn', () => app.cancelTransfer())
  bindClick('select-files-btn', () => {
    const input = document.getElementById('file-input') as HTMLInputElement | null
    input?.click()
  })
  bindChange('file-input', (event) => app.handleFileSelect(event))
  bindClick('clear-file-btn', () => app.clearFile())
  bindClick('create-link-btn', () => void app.createP2PLink())
  bindChange('cloud-upload-checkbox', (event) => {
    app.handleProToggle(event.currentTarget as HTMLInputElement, 'cloud')
  })
  bindChange('password-protect-checkbox', (event) => {
    app.handleProToggle(event.currentTarget as HTMLInputElement, 'password')
  })
  bindClick('copy-link-btn', () => void app.copyLink())
  bindClick('email-link-btn', () => app.emailLink())
  bindClick('show-qr-btn', () => void app.showQR())
  bindClick('start-download-btn', () => app.startDownload())
  bindClick('hide-how-it-works-btn', () => ModalHelpers.hideHowItWorks())

  bindModalDismiss('how-modal', () => ModalHelpers.hideHowItWorks())
  bindModalDismiss('qr-modal', () => app.hideQR())

  const dropZone = document.getElementById('drop-zone')
  dropZone?.addEventListener('drop', (event) => app.handleDrop(event as DragEvent))
  dropZone?.addEventListener('dragover', (event) => app.handleDragOver(event as DragEvent))
  dropZone?.addEventListener('dragleave', (event) => app.handleDragLeave(event as DragEvent))
}

function bindClick(id: string, listener: (event: MouseEvent) => void) {
  document.getElementById(id)?.addEventListener('click', listener)
}

function bindChange(id: string, listener: (event: Event) => void) {
  document.getElementById(id)?.addEventListener('change', listener)
}

function bindModalDismiss(id: string, onDismiss: () => void) {
  const modal = document.getElementById(id)
  if (!modal) return

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      onDismiss()
    }
  })
}
