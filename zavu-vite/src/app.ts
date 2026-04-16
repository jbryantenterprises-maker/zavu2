import { WebRTCManager } from './webrtc.js';
import type { SignalData, FileMetadata } from './webrtc.js';
import { FileHandler, formatBytes } from './file-handler.js';
import type { SelectedFile } from './file-handler.js';
import { UIHelper } from './ui-helpers.js';
import { CloudStorageService } from './cloud-storage.js';
import { FileEncryption } from './encryption.js';
import { FileReceiver } from './file-receiver.js';
import { AuthService } from './auth.js';
import { PaymentService } from './payment.js';
import { parseCloudDownloadFragment, downloadAndDecryptFile } from './cloud-download.js';

/** Escape HTML special characters to prevent XSS when inserting user content */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export class XavuApp {
  private static readonly CLOUD_CLEANUP_STORAGE_KEY = 'xavuCloudFiles';
  private webrtc: WebRTCManager;
  private fileHandler: FileHandler;
  private cloudStorage: CloudStorageService;
  private encryptionKey: CryptoKey | null = null;
  private transferInProgress: boolean = false;
  private unackedChunks: number = 0;
  private readonly MAX_WINDOW: number = 32;
  private resumeReading: (() => void) | null = null;
  private fileReceiver: FileReceiver | null = null;
  private currentReceivingFileIndex: number = 0;
  private activeDownloadLink: string | null = null;
  private checkoutStatusHandled: boolean = false;
  /** Tracks whether the current transfer is a cloud upload (for context-aware UI) */
  private isCloudTransfer: boolean = false;
  /** Stores cloud download URLs for proper copy/email */
  private cloudDownloadUrls: string[] = [];
  private cloudCleanupUserId: string | null = null;
  private senderFlowToken = 0;

  constructor() {
    this.webrtc = new WebRTCManager();
    this.fileHandler = new FileHandler();
    
    // Initialize cloud storage service (Cloudflare R2)
    this.cloudStorage = new CloudStorageService();
    
    this.init();
  }

  private init() {
    this.setupEventListeners();
    this.handleBillingReturnState();
    this.checkForCloudDownload() || this.checkForReceiverLink();
    this.setupBeforeUnload();

    // Auth & Payments
    AuthService.init();
    PaymentService.init();
    AuthService.onAuthStateChanged((user) => {
      this.updateAuthUI(user);
      if (user && user.uid !== this.cloudCleanupUserId) {
        this.cloudCleanupUserId = user.uid;
        void this.cleanupExpiredCloudFiles();
      } else if (!user) {
        this.cloudCleanupUserId = null;
      }
    });
  }

  private updateAuthUI(user: any) {
    const authBtn = document.getElementById('auth-btn');
    if (user) {
      if (authBtn) authBtn.textContent = 'Sign Out';
      UIHelper.showElement('user-name');
      UIHelper.showElement('manage-billing-btn');
      UIHelper.updateElementText('user-name', user.displayName || user.email || 'You');
      
      if (user.isPro) {
        UIHelper.hideElement('upgrade-btn');
        UIHelper.showElement('pro-badge');
      } else {
        UIHelper.showElement('upgrade-btn');
        UIHelper.hideElement('pro-badge');
      }
    } else {
      if (authBtn) authBtn.textContent = 'Sign In';
      UIHelper.hideElement('upgrade-btn');
      UIHelper.hideElement('pro-badge');
      UIHelper.hideElement('manage-billing-btn');
      UIHelper.hideElement('user-name');
    }
  }

  handleAuthClick() {
    if (AuthService.getUser()) {
      AuthService.signOut();
    } else {
      this.showSignInModal();
    }
  }

  showSignInModal() {
    UIHelper.showElement('signin-modal');
    UIHelper.hideElement('signup-modal');
    UIHelper.hideElement('reset-modal');
  }

  showSignUpModal() {
    UIHelper.showElement('signup-modal');
    UIHelper.hideElement('signin-modal');
    UIHelper.hideElement('reset-modal');
  }

  showResetModal() {
    UIHelper.showElement('reset-modal');
    UIHelper.hideElement('signin-modal');
    UIHelper.hideElement('signup-modal');
  }

  hideAuthModals() {
    UIHelper.hideElement('signin-modal');
    UIHelper.hideElement('signup-modal');
    UIHelper.hideElement('reset-modal');
  }

  async handleSignIn(email: string, password: string) {
    const result = await AuthService.signIn(email, password);
    if (result.success) {
      this.hideAuthModals();
      UIHelper.hideElement('signin-error');
    } else {
      UIHelper.showElement('signin-error');
      UIHelper.updateElementText('signin-error', result.error || 'Sign in failed');
    }
  }

  async handleSignUp(email: string, password: string, confirmPassword: string) {
    if (password !== confirmPassword) {
      UIHelper.showElement('signup-error');
      UIHelper.updateElementText('signup-error', 'Passwords do not match');
      return;
    }

    const result = await AuthService.signUp(email, password);
    if (result.success) {
      this.hideAuthModals();
      UIHelper.hideElement('signup-error');
    } else {
      UIHelper.showElement('signup-error');
      UIHelper.updateElementText('signup-error', result.error || 'Sign up failed');
    }
  }

  async handlePasswordReset(email: string) {
    const result = await AuthService.resetPassword(email);
    if (result.success) {
      UIHelper.showElement('reset-success');
      UIHelper.hideElement('reset-error');
      UIHelper.updateElementText('reset-success', 'Password reset email sent! Check your inbox.');
      setTimeout(() => this.showSignInModal(), 3000);
    } else {
      UIHelper.showElement('reset-error');
      UIHelper.hideElement('reset-success');
      UIHelper.updateElementText('reset-error', result.error || 'Failed to send reset email');
    }
  }

  checkoutPro() {
    this.showPlanModal();
  }

  manageBilling() {
    void PaymentService.openBillingPortal();
  }

  showPlanModal() {
    UIHelper.showElement('plan-modal');
  }

  hidePlanModal() {
    UIHelper.hideElement('plan-modal');
  }

  async selectPlan(plan: 'monthly' | 'yearly') {
    this.hidePlanModal();
    await PaymentService.upgradeToPro(plan);
  }

  private handleBillingReturnState() {
    if (this.checkoutStatusHandled) return;
    this.checkoutStatusHandled = true;

    const url = new URL(window.location.href);
    const checkout = url.searchParams.get('checkout');
    const billing = url.searchParams.get('billing');

    if (checkout === 'success') {
      this.showBillingMessage('Checkout complete. Your Pro access will update after Stripe confirms the subscription.', 'success');
      UIHelper.confettiBurst();
      void AuthService.refreshIdToken(true);
    } else if (checkout === 'cancelled') {
      this.showBillingMessage('Checkout was cancelled. You can try again whenever you want.', 'info');
    } else if (billing === 'returned') {
      this.showBillingMessage('Returned from the billing portal.', 'info');
      void AuthService.refreshIdToken(true);
    }

    if (checkout || billing) {
      url.searchParams.delete('checkout');
      url.searchParams.delete('billing');
      window.history.replaceState({}, document.title, url.toString());
    }
  }

  private showBillingMessage(message: string, tone: 'success' | 'info') {
    UIHelper.updateElementText('billing-status-text', message);
    UIHelper.removeClass(
      'billing-status',
      'hidden',
      'border-emerald-400/30',
      'bg-emerald-400/10',
      'text-emerald-300',
      'border-zinc-700',
      'bg-zinc-900',
      'text-zinc-200'
    );
    if (tone === 'success') {
      UIHelper.addClass('billing-status', 'border-emerald-400/30', 'bg-emerald-400/10', 'text-emerald-300');
    } else {
      UIHelper.addClass('billing-status', 'border-zinc-700', 'bg-zinc-900', 'text-zinc-200');
    }
  }

  handleProToggle(checkbox: HTMLInputElement, feature: string) {
    const user = AuthService.getUser();
    if (!user || !user.isPro) {
       checkbox.checked = false;
       alert(`You need to upgrade to Pro to use the "${feature}" feature.`);
    }
  }

  private setupEventListeners() {
    // Prevent accidental navigation when dropping files
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }

  private setupBeforeUnload() {
    window.addEventListener('beforeunload', (e) => {
      if (this.transferInProgress) {
        e.preventDefault();
        e.returnValue = 'Transfer in progress. Are you sure you want to leave?';
      }
    });
  }

  // ── Cloud Download Detection ─────────────────────────────────────────

  /**
   * Check if the current URL is a cloud download link (contains /api/download/ and
   * has decryption params in the fragment). If so, show the cloud download UI.
   * Returns true if a cloud download was detected.
   */
  private checkForCloudDownload(): boolean {
    const url = window.location.href;
    const hash = window.location.hash;

    // Cloud download links look like: /api/download/...?token=...&expires=...#key=...
    if (!url.includes('/api/download/') || !hash) return false;

    const params = parseCloudDownloadFragment(hash);
    if (!params) return false;

    // Show the cloud download UI
    UIHelper.hideElement('landing-screen');
    UIHelper.showElement('receiver-screen');

    if (params.isPasswordProtected) {
      this.showPasswordPromptForDownload(url, params);
    } else {
      this.startCloudDownload(url, params);
    }

    return true;
  }

  private showPasswordPromptForDownload(url: string, params: ReturnType<typeof parseCloudDownloadFragment>) {
    if (!params) return;

    UIHelper.hideElement('receiver-waiting');
    UIHelper.showElement('receiver-connected');
    UIHelper.updateElementText('incoming-file-name', '🔐 This file is password protected');
    UIHelper.updateElementText('incoming-file-size', 'Enter the password to decrypt and download');

    // Repurpose the download button to prompt for password
    const downloadBtn = document.querySelector('#receiver-connected button') as HTMLElement;
    if (downloadBtn) {
      downloadBtn.style.display = '';
      downloadBtn.textContent = 'Enter Password & Download';
      downloadBtn.onclick = () => {
        const password = prompt('Enter the password for this file:');
        if (password) {
          downloadBtn.style.display = 'none';
          void this.startCloudDownload(url, params, password);
        }
      };
    }
  }

  private async startCloudDownload(
    url: string,
    params: ReturnType<typeof parseCloudDownloadFragment>,
    password?: string
  ) {
    if (!params) return;

    UIHelper.hideElement('receiver-waiting');
    UIHelper.hideElement('receiver-connected');
    UIHelper.showElement('receiver-progress-area');
    UIHelper.updateElementText('receiver-progress-text', 'Downloading and decrypting…');

    const result = await downloadAndDecryptFile(
      url,
      params,
      password,
      (progress) => {
        UIHelper.setProgressBar('receiver-progress-bar', progress);
        if (progress < 70) {
          UIHelper.updateElementText('receiver-progress-text', `Downloading… ${progress}%`);
        } else if (progress < 95) {
          UIHelper.updateElementText('receiver-progress-text', 'Decrypting file…');
        } else {
          UIHelper.updateElementText('receiver-progress-text', '✅ File decrypted and downloaded!');
        }
      }
    );

    if (result.success) {
      UIHelper.updateElementText('receiver-progress-text', '✅ File decrypted and downloaded!');
      UIHelper.confettiBurst();
    } else {
      UIHelper.updateElementText('receiver-progress-text', `❌ ${result.error}`);
      if (params.isPasswordProtected) {
        UIHelper.hideElement('receiver-progress-area');
        UIHelper.showElement('receiver-connected');
        const downloadBtn = document.querySelector('#receiver-connected button') as HTMLElement | null;
        if (downloadBtn) {
          downloadBtn.style.display = '';
        }
      }
    }
  }

  // Screen Management
  startSending() {
    UIHelper.hideElement('landing-screen');
    UIHelper.showElement('sender-screen');
    UIHelper.hideElement('file-preview');
    UIHelper.showElement('drop-zone');
  }

  pasteLink() {
    const link = prompt("Paste the Xavu URL you received via email:");
    if (!link) return;
    
    try {
      const url = new URL(link);
      const id = url.searchParams.get('id');
      if (id) {
        UIHelper.hideElement('landing-screen');
        UIHelper.showElement('receiver-screen');
        UIHelper.updateElementText('receiver-sender-id', `Connecting to ${id.slice(0, 8)}…`);
        this.connectAsReceiver(id);
      } else if (url.pathname.includes('/api/download/') && url.hash) {
        window.location.href = link;
      } else {
        alert("Invalid link. Use a Xavu P2P link or a cloud download link.");
      }
    } catch (e) {
      alert("Not a valid URL");
    }
  }

  // File Handling
  handleFileSelect(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length > 0) {
      const selectedFiles = this.fileHandler.handleFileSelect(files);
      this.showFilePreview(selectedFiles);
    }
  }

  handleDrop(e: DragEvent) {
    const selectedFiles = this.fileHandler.handleDrop(e);
    if (selectedFiles.length > 0) {
      this.showFilePreview(selectedFiles);
    }
    UIHelper.removeClass('drop-zone', 'drag-active', 'border-emerald-400');
  }

  handleDragOver(e: DragEvent) {
    e.preventDefault();
    UIHelper.addClass('drop-zone', 'drag-active', 'border-emerald-400');
  }

  handleDragLeave(_e: DragEvent) {
    UIHelper.removeClass('drop-zone', 'drag-active', 'border-emerald-400')
  }

  private showFilePreview(selectedFiles: SelectedFile[]) {
    UIHelper.hideElement('drop-zone');
    UIHelper.showElement('file-preview');

    const files = this.fileHandler.getSelectedFiles();
    const totalSize = this.fileHandler.getTotalSize();

    // Enforce Pro limitations
    const user = AuthService.getUser();
    const isPro = user?.isPro || false;
    const maxFreeSize = 500 * 1024 * 1024; // 500 MB

    if (!isPro && totalSize > maxFreeSize) {
      alert(`Free accounts are limited to 500MB per transfer. You selected ${formatBytes(totalSize)}.\nPlease sign in and upgrade to Pro to send unlimited size files.`);
      this.clearFile();
      return;
    }
    
    if (files.length === 1) {
      UIHelper.updateElementText('file-name', files[0].name);
      UIHelper.updateElementText('file-size', formatBytes(files[0].size));
      UIHelper.updateElementText('file-icon', selectedFiles[0].icon);
    } else {
      UIHelper.updateElementText('file-name', `${files.length} files selected`);
      UIHelper.updateElementText('file-size', formatBytes(totalSize));
      UIHelper.updateElementText('file-icon', '📁');
    }
  }

  clearFile() {
    this.fileHandler.clearFiles();
    UIHelper.hideElement('file-preview');
    UIHelper.showElement('drop-zone');
  }

  // P2P Link Creation
  async createP2PLink(existingId: string | null = null) {
    const files = this.fileHandler.getSelectedFiles();
    if (files.length === 0) {
      alert("Select a file first!");
      return;
    }

    const isCloudUpload = (document.getElementById('cloud-upload-checkbox') as HTMLInputElement)?.checked;
    if (isCloudUpload) {
      const user = AuthService.getUser();
      if (!user || !user.isPro) {
        alert('You need a Pro account to use cloud uploads.');
        return;
      }

      // Check if password protection is enabled
      const isPasswordProtected = (document.getElementById('password-protect-checkbox') as HTMLInputElement)?.checked;
      let password: string | undefined;
      if (isPasswordProtected) {
        password = prompt('Set a password for this file transfer.\nRecipient will need this password to download:') || undefined;
        if (!password) return; // User cancelled
      }

      return this.uploadDirectToCloud(files, password);
    }

    UIHelper.hideElement('file-preview');
    UIHelper.hideElement('drop-zone');

    // Generate encryption key for this transfer
    this.senderFlowToken++;
    this.encryptionKey = await FileEncryption.generateKey();
    const roomId = existingId || crypto.randomUUID().replace(/-/g, '').substring(0, 12);
    
    this.webrtc.createRoom(roomId);
    this.isCloudTransfer = false;
    this.cloudDownloadUrls = [];

    const flowToken = this.senderFlowToken;
    setTimeout(async () => {
      if (flowToken !== this.senderFlowToken) return;
      const totalSize = this.fileHandler.getTotalSize();
      const fileMetas = this.fileHandler.getFileMetadata();

      // Build shareable link
      const baseUrl = window.location.origin + window.location.pathname;
      const shareLink = `${baseUrl}?id=${roomId}`;

      UIHelper.updateElement('share-link-display', `
        <div class="flex items-center justify-between">
          <span class="text-emerald-400 font-medium">${escapeHtml(shareLink)}</span>
        </div>
      `);

      // P2P-specific UI text
      this.updateLinkScreenText(false);
      UIHelper.showElement('link-screen');

      console.log('%c✅ Xavu created — ID: ' + roomId, 'color:#00ff9d; font-family:monospace');

      this.setupSenderListeners(fileMetas, totalSize, flowToken);
    }, 100);
  }

  /**
   * Update the link screen header, status, and warning text based on transfer type.
   */
  private updateLinkScreenText(isCloud: boolean) {
    const titleEl = document.getElementById('link-screen-title');
    const warningEl = document.getElementById('link-screen-warning');

    if (isCloud) {
      if (titleEl) titleEl.textContent = 'Your cloud download link is ready';
      if (warningEl) warningEl.innerHTML = '☁️ File uploaded to encrypted cloud storage.<br>This link is valid for 7 days. You can close this tab.';
    } else {
      if (titleEl) titleEl.textContent = 'Your live P2P link is ready';
      if (warningEl) warningEl.innerHTML = '⚠️ Keep this tab open until the transfer finishes.<br>The file lives only in your browser memory.';
    }
  }

  private setupSenderListeners(fileMetas: FileMetadata[], totalSize: number, flowToken: number) {
    let connectionTimeout: NodeJS.Timeout;
    
    this.webrtc.onPeerJoin(async (peerId) => {
      if (flowToken !== this.senderFlowToken || this.isCloudTransfer) return;
      clearTimeout(connectionTimeout);
      this.webrtc.setCurrentPeer(peerId);
      console.log('Receiver connected!', peerId);
      UIHelper.updateElement('peer-status', '<span class="text-emerald-400">✅ CONNECTED</span>');
      
      this.webrtc.sendSignalData({
        type: 'metadata',
        files: fileMetas,
        totalSize: totalSize,
        encryptionKey: await FileEncryption.keyToBase64(this.encryptionKey!)
      }, peerId);
    });

    // Set timeout for P2P connection
    connectionTimeout = setTimeout(() => {
      if (flowToken !== this.senderFlowToken || this.isCloudTransfer) return;
      if (!this.webrtc.getCurrentPeer()) {
        const user = AuthService.getUser();
        if (user?.isPro && this.cloudStorage.isConfigured()) {
          console.log('P2P connection failed, falling back to cloud storage (Pro)');
          this.fallbackToCloudStorage(fileMetas, flowToken);
        } else {
          UIHelper.updateElement('peer-status', '<span class="text-red-500">?? P2P CONNECTION FAILED</span>');
          UIHelper.updateElement('sender-progress-text', `
            ?? Unable to establish P2P connection<br>
            <span class="text-xs text-zinc-400">
              Your network may be blocking peer-to-peer connections.<br>
              Try: different network, disable VPN/firewall, or upgrade to Pro for cloud storage
            </span>
          `);
          console.log('P2P connection failed ? network blocking P2P or restrictive firewall');
        }
      }
    }, 10000); // 10 second timeout

    this.webrtc.onSignal((data: SignalData, peerId: string) => {
      if (flowToken !== this.senderFlowToken || this.isCloudTransfer) return;
      if (data.type === 'start_download') {
        this.startMultiFileTransfer(peerId, data.fileIndex || 0, data.offset || 0);
      } else if ((data as any) === 'start_download') {
        this.startMultiFileTransfer(peerId, 0, 0);
      } else if ((data as any) === 'received') {
        console.log('Receiver acknowledged full system');
      } else if (data.type === 'ack_chunk') {
        this.unackedChunks--;
        if (this.resumeReading && this.unackedChunks < this.MAX_WINDOW / 2) {
          const r = this.resumeReading;
          this.resumeReading = null;
          r();
        }
      }
    });

    this.webrtc.onPeerLeave((peerId) => {
      if (flowToken !== this.senderFlowToken) return;
      if (peerId === this.webrtc.getCurrentPeer()) {
        UIHelper.updateElement('peer-status', '<span class="text-red-500">❌ DISCONNECTED</span>');
        UIHelper.updateElement('sender-progress-text', '<span class="text-red-500">Error: Receiver disconnected mid-transfer.</span>');
      }
    });
  }

  // File Transfer
  private startMultiFileTransfer(peerTarget: string, startIndex: number = 0, startOffset: number = 0) {
    this.transferInProgress = true;
    const files = this.fileHandler.getSelectedFiles();
    
    let globalOffset = 0; 
    for (let i = 0; i < startIndex; i++) {
      globalOffset += files[i].size;
    }
    globalOffset += startOffset;
    
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    let startTime = Date.now();
    let bytesSentSinceStart = 0;

    const sendFile = async (index: number, offset: number) => {
      if (index >= files.length) {
        setTimeout(() => {
          this.webrtc.sendSignalData({ type: 'end_all' }, peerTarget);
          this.transferInProgress = false;
          UIHelper.updateElement('sender-progress-text', `
            ✅ Transfer complete! 🎉<br>
            <span class="text-xs">You can now close this tab.</span>
          `);
          UIHelper.confettiBurst();
        }, 500);
        return;
      }

      const file = files[index];
      let currentFileOffset = offset;
      
      this.webrtc.sendSignalData({ 
        type: 'next_file', 
        index: index, 
        name: file.name, 
        size: file.size, 
        mime: file.type || 'application/octet-stream'
      }, peerTarget);

      const reader = file.stream().getReader();
      
      const readNextChunk = async () => {
        if (this.unackedChunks >= this.MAX_WINDOW) {
          this.resumeReading = readNextChunk;
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          const waitAcks = setInterval(() => {
            if (this.unackedChunks === 0) {
              clearInterval(waitAcks);
              setTimeout(() => {
                this.webrtc.sendSignalData({ type: 'file_end', index: index }, peerTarget);
                sendFile(index + 1, 0);
              }, 50);
            }
          }, 50);
          return;
        }

        const encryptedChunk = await FileEncryption.encryptChunk(value, this.encryptionKey!);
        this.webrtc.sendChunkData(FileEncryption.toArrayBuffer(encryptedChunk), peerTarget);
        this.unackedChunks++;

        bytesSentSinceStart += value.byteLength;
        currentFileOffset += value.byteLength;
        globalOffset += value.byteLength;
        
        const progress = Math.min(Math.round((globalOffset / totalSize) * 100), 100);
        
        UIHelper.showElement('sender-progress-area');
        UIHelper.setProgressBar('sender-progress-bar', progress);
        UIHelper.updateElement('sender-progress-text', `
          ${progress}% • ${formatBytes(globalOffset)} / ${formatBytes(totalSize)} <br>
          <span class="text-xs text-zinc-500">Sending ${index + 1} of ${files.length} (encrypted)</span>
        `); // progress text is safe — no user-provided strings

        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed > 1) {
          const speed = Math.round((bytesSentSinceStart / elapsed) / 1024);
          UIHelper.updateElementText('transfer-speed', `${speed} KB/s`);
          startTime = Date.now();
          bytesSentSinceStart = 0;
        }

        readNextChunk();
      };
      
      setTimeout(readNextChunk, 100);
    };

    sendFile(startIndex, startOffset);
  }

  private async fallbackToCloudStorage(fileMetas: FileMetadata[], flowToken: number) {
    if (flowToken !== this.senderFlowToken) return;
    this.senderFlowToken++;
    this.webrtc.leaveRoom();
    this.webrtc.setCurrentPeer('');
    this.isCloudTransfer = true;
    this.cloudDownloadUrls = [];
    this.updateLinkScreenText(true);

    UIHelper.updateElement('peer-status', '<span class="text-yellow-500">⚡ UPLOADING TO CLOUD</span>');
    UIHelper.updateElement('sender-progress-text', '<span class="text-yellow-500">P2P failed, uploading to encrypted cloud storage...</span>');
    
    const files = this.fileHandler.getSelectedFiles();
    const uploadedLinks: string[] = [];
    const uploadedFileIds: string[] = [];
    let latestExpiresAt = 0;
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const metadata = fileMetas[i];
        
        UIHelper.updateElement('sender-progress-text', `
          Encrypting and uploading ${i + 1} of ${files.length}: ${escapeHtml(file.name)}<br>
          <span class="text-xs text-zinc-500">Fallback to encrypted cloud storage</span>
        `);
        
        const result = await this.cloudStorage.uploadFile(file, metadata);
        
        if (result.success && result.downloadUrl) {
          uploadedLinks.push(result.downloadUrl);
          if (result.fileId) uploadedFileIds.push(result.fileId);
          if (result.expiresAt) latestExpiresAt = Math.max(latestExpiresAt, result.expiresAt);
          
          const progress = Math.round(((i + 1) / files.length) * 100);
          UIHelper.showElement('sender-progress-area');
          UIHelper.setProgressBar('sender-progress-bar', progress);
        } else {
          throw new Error(result.error || 'Upload failed');
        }
      }

      // Display ALL links (fix for issue #3)
      this.cloudDownloadUrls = uploadedLinks;
      const linksHtml = uploadedLinks
        .map(url => `<div class="mb-2"><span class="text-emerald-400 font-medium break-all text-xs lg:text-sm">${escapeHtml(url)}</span></div>`)
        .join('');
      UIHelper.updateElement('share-link-display', linksHtml);
      
      UIHelper.updateElement('sender-progress-text', `
        ✅ Uploaded to encrypted cloud! <br>
        <span class="text-xs">Share the link${uploadedLinks.length > 1 ? 's' : ''} above (Valid for 7 days).</span>
      `);
      
      // Store ALL file IDs for cleanup (fix for issue #4)
      this.recordCloudUploads(uploadedFileIds, latestExpiresAt);
    } catch (error) {
      console.error('Cloud storage fallback failed:', error);
      UIHelper.updateElement('sender-progress-text', `
        ❌ Both P2P and cloud storage failed<br>
        <span class="text-xs text-red-500">Please try again</span>
      `);
    }
  }

  private async uploadDirectToCloud(files: File[], password?: string) {
    this.senderFlowToken++;
    this.webrtc.leaveRoom();
    this.webrtc.setCurrentPeer('');
    this.isCloudTransfer = true;
    this.cloudDownloadUrls = [];

    UIHelper.hideElement('file-preview');
    UIHelper.hideElement('drop-zone');
    
    UIHelper.showElement('link-screen');
    this.updateLinkScreenText(true);
    UIHelper.updateElement('peer-status', '<span class="text-emerald-400">⚡ ENCRYPTING & UPLOADING TO CLOUD</span>');
    UIHelper.updateElementText('share-link-display', 'Encrypting and uploading...');
    
    UIHelper.showElement('sender-progress-area');
    UIHelper.setProgressBar('sender-progress-bar', 10); // Just a visual start
    
    const uploadedLinks: string[] = [];
    const uploadedFileIds: string[] = [];
    let latestExpiresAt = 0;
    
    try {
      const fileMetas = this.fileHandler.getFileMetadata();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const metadata = fileMetas[i];
        
        UIHelper.updateElement('sender-progress-text', `
          Encrypting & uploading ${i + 1} of ${files.length}: ${escapeHtml(file.name)}<br>
          <span class="text-xs text-emerald-400 font-medium">Creating encrypted 7-day link${password ? ' (password protected)' : ''}</span>
        `);
        
        const result = await this.cloudStorage.uploadFile(file, metadata, password);
        
        if (result.success && result.downloadUrl) {
          uploadedLinks.push(result.downloadUrl);
          if (result.fileId) uploadedFileIds.push(result.fileId);
          if (result.expiresAt) latestExpiresAt = Math.max(latestExpiresAt, result.expiresAt);
          
          const progress = Math.round(((i + 1) / files.length) * 100);
          UIHelper.setProgressBar('sender-progress-bar', progress);
        } else {
          throw new Error(result.error || `Upload failed for ${file.name}`);
        }
      }
      
      // Store URLs for copy/email (fix for issue #9)
      this.cloudDownloadUrls = uploadedLinks;

      // Display all links
      const linksHtml = uploadedLinks
        .map(url => `<div class="mb-2"><span class="text-emerald-400 font-medium break-all text-xs lg:text-sm">${escapeHtml(url)}</span></div>`)
        .join('');
      UIHelper.updateElement('share-link-display', linksHtml);

      UIHelper.updateElement('sender-progress-text', `
        ✅ Upload complete! 🎉<br>
        <span class="text-xs">Share the link${uploadedLinks.length > 1 ? 's' : ''} above (Valid for 7 days).${password ? ' 🔐 Password protected.' : ''}</span>
      `);
      UIHelper.confettiBurst();
      
      this.recordCloudUploads(uploadedFileIds, latestExpiresAt);
    } catch (error: any) {
      console.error('Cloud storage upload failed:', error);
      UIHelper.updateElement('sender-progress-text', `
        ❌ Upload failed<br>
        <span class="text-xs text-red-500">${escapeHtml(error.message || 'Please try again')}</span>
      `);
    }
  }

  // Receiver Mode
  private connectAsReceiver(targetId: string) {
    this.webrtc.joinRoom(targetId);
    this.webrtc.setCurrentPeer(targetId);

    this.setupReceiverListeners();

    // Set timeout for receiver connection
    setTimeout(() => {
      if (!this.webrtc.getCurrentPeer() || this.webrtc.getCurrentPeer() === targetId) {
        // Still using the initial targetId means we haven't connected to the actual sender yet
        UIHelper.updateElementText('receiver-progress-text', `
          ?? Unable to connect to sender<br>
          <span class="text-xs text-zinc-500">
            Your network may be blocking P2P connections.<br>
            Try a different network or ask sender to use cloud storage via Pro account
          </span>
        `);
      }
    }, 15000); // 15 second timeout for receiver
  }

  private setupReceiverListeners() {
    this.webrtc.onPeerJoin((peerId) => {
      console.log('Detected connected peer in room:', peerId);
      // Save the sender's real peer ID so we can request the download from them
      this.webrtc.setCurrentPeer(peerId);
    });

    this.fileReceiver = new FileReceiver(
      (progress) => {
        UIHelper.showElement('receiver-progress-area');
        UIHelper.setProgressBar('receiver-progress-bar', progress);
        UIHelper.updateElementText('receiver-progress-text', `${progress}%`);
      },
      (file) => {
        // Revoke previous Object URL to prevent memory leaks
        if (this.activeDownloadLink) {
          URL.revokeObjectURL(this.activeDownloadLink);
        }
        // Create an automatic download
        this.activeDownloadLink = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = this.activeDownloadLink;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        UIHelper.updateElementText('receiver-progress-text', '✅ File received and decrypted!');
        UIHelper.confettiBurst();
        
        // Let sender know we received this file successfully
        const peer = this.webrtc.getCurrentPeer();
        if (peer) {
          this.webrtc.sendSignalData({ type: 'received' }, peer);
        }
      },
      (error) => {
        console.error('Receiver error:', error);
        UIHelper.updateElementText('receiver-progress-text', `❌ Error: ${error}`);
      }
    );

    this.webrtc.onSignal(async (data: SignalData) => {
      if (data.type === 'metadata') {
        await this.fileReceiver?.handleMetadata(data);
        
        // Show file info in UI
        if (data.files && data.files.length > 0) {
          const files = data.files;
          const displayNames = files.map(f => f.name).join(', ');
          const totalSizeText = formatBytes(data.totalSize || files.reduce((acc, f) => acc + f.size, 0));
          
          UIHelper.updateElementText('incoming-file-name', files.length > 1 ? `${files.length} files (${displayNames})` : displayNames);
          UIHelper.updateElementText('incoming-file-size', totalSizeText);
          
          // Switch UI state
          UIHelper.hideElement('receiver-waiting');
          UIHelper.showElement('receiver-connected');
        }
      } else if (data.type === 'next_file') {
        // Setup for next file
        this.currentReceivingFileIndex = data.index || 0;
        this.fileReceiver?.reset();
        UIHelper.updateElementText('receiver-progress-text', `Preparing file ${data.name}...`);
        UIHelper.setProgressBar('receiver-progress-bar', 0);
      } else if (data.type === 'file_end') {
        const metadata = this.fileReceiver?.getMetadata();
        if (metadata && metadata.files && metadata.files[this.currentReceivingFileIndex]) {
          const fileMeta = metadata.files[this.currentReceivingFileIndex];
          UIHelper.updateElementText('receiver-progress-text', 'Decrypting data (this may take a moment)...');
          
          // Yield to let UI update
          setTimeout(async () => {
             await this.fileReceiver?.completeFile(fileMeta.name, fileMeta.mime);
          }, 50);
        }
      } else if (data.type === 'end_all') {
        UIHelper.updateElementText('receiver-progress-text', 'All files transferred completely! 🎉');
      }
    });

    this.webrtc.onChunk(async (chunk: ArrayBuffer, peerId: string) => {
      const metadata = this.fileReceiver?.getMetadata();
      const currentSize = metadata?.files?.[this.currentReceivingFileIndex]?.size || metadata?.totalSize || 1;

      try {
        await this.fileReceiver?.handleChunk(chunk, currentSize);
        // Send ack to maintain backpressure
        this.webrtc.sendSignalData({ type: 'ack_chunk' }, peerId);
      } catch (error) {
        console.error('Receiver chunk error:', error);
        UIHelper.updateElementText('receiver-progress-text', '❌ Error: Failed to decrypt transfer chunk.');
      }
    });

    this.webrtc.onPeerLeave((peerId) => {
      if (peerId === this.webrtc.getCurrentPeer()) {
        UIHelper.updateElementText('receiver-progress-text', '❌ Error: Sender disconnected mid-transfer.');
      }
    });
  }

  startDownload() {
    const peer = this.webrtc.getCurrentPeer();
    if (peer) {
      // Hide the download button since it's starting
      const button = document.querySelector('#receiver-connected button') as HTMLElement;
      if (button) button.style.display = 'none';
      
      this.webrtc.sendSignalData({ type: 'start_download' }, peer);
      UIHelper.showElement('receiver-progress-area');
      UIHelper.updateElementText('receiver-progress-text', 'Connecting and requesting file...');
    }
  }

  // Utility Methods
  private checkForReceiverLink() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      UIHelper.hideElement('landing-screen');
      UIHelper.showElement('receiver-screen');
      UIHelper.updateElementText('receiver-sender-id', `Connecting to peer ${id.slice(0, 8)}…`);
      this.connectAsReceiver(id);
    }
  }

  cancelTransfer() {
    this.webrtc.leaveRoom();
    window.location.reload();
  }

  private recordCloudUploads(fileIds: string[], expiresAt: number) {
    if (fileIds.length === 0) return;

    const existing = this.getStoredCloudUploads();
    for (const fileId of fileIds) {
      existing.push({ fileId, expiresAt });
    }
    localStorage.setItem(XavuApp.CLOUD_CLEANUP_STORAGE_KEY, JSON.stringify(existing));
  }

  private getStoredCloudUploads(): Array<{ fileId: string; expiresAt: number }> {
    const raw = localStorage.getItem(XavuApp.CLOUD_CLEANUP_STORAGE_KEY);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed.filter((entry): entry is { fileId: string; expiresAt: number } =>
        typeof entry?.fileId === 'string' && typeof entry?.expiresAt === 'number'
      );
    } catch {
      localStorage.removeItem(XavuApp.CLOUD_CLEANUP_STORAGE_KEY);
      return [];
    }
  }

  private async cleanupExpiredCloudFiles() {
    const stored = this.getStoredCloudUploads();
    if (stored.length === 0) return;

    const now = Date.now();
    const expired = stored.filter((entry) => entry.expiresAt <= now);
    const fresh = stored.filter((entry) => entry.expiresAt > now);

    if (expired.length === 0) return;

    const result = await this.cloudStorage.deleteFiles(expired.map((entry) => entry.fileId));
    if (!result.success) {
      console.warn('Failed to clean up expired cloud uploads:', result.error);
      return;
    }

    localStorage.setItem(XavuApp.CLOUD_CLEANUP_STORAGE_KEY, JSON.stringify(fresh));
  }



  // Link sharing methods — context-aware for P2P vs cloud
  async copyLink() {
    try {
      if (this.isCloudTransfer && this.cloudDownloadUrls.length > 0) {
        // Copy all cloud download URLs, one per line
        const text = this.cloudDownloadUrls.join('\n');
        await UIHelper.copyToClipboard(text);
      } else {
        await UIHelper.copyLink('share-link-display');
      }
      
      // Look for the copy button specifically
      const buttons = document.querySelectorAll('button');
      let targetButton = Array.from(buttons).find(b => b.textContent?.includes('Copy link'));
      
      if (targetButton) {
        const orig = targetButton.innerHTML;
        targetButton.innerHTML = '✅ Copied!';
        setTimeout(() => targetButton!.innerHTML = orig, 1500);
      }
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  }

  emailLink() {
    if (this.isCloudTransfer && this.cloudDownloadUrls.length > 0) {
      UIHelper.emailCloudLink(this.cloudDownloadUrls);
    } else {
      const linkElement = document.getElementById('share-link-display');
      const link = linkElement?.textContent?.trim() || '';
      UIHelper.emailLink(link);
    }
  }

  async showQR() {
    // For QR, use the first link (QR can only encode one)
    let link: string;
    if (this.isCloudTransfer && this.cloudDownloadUrls.length > 0) {
      link = this.cloudDownloadUrls[0];
    } else {
      const linkElement = document.getElementById('share-link-display');
      link = linkElement?.textContent?.trim() || '';
    }

    UIHelper.showElement('qr-modal');
    
    try {
      await UIHelper.showQRCode('qr-canvas', link);
    } catch (error) {
      console.error('Failed to generate QR code:', error);
    }
  }

  hideQR() {
    UIHelper.hideElement('qr-modal');
  }
}
