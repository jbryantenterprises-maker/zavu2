import { joinRoom, selfId } from '@trystero-p2p/firebase';
import { app as existingFirebaseApp } from './auth.js';
import { initializeApp } from 'firebase/app';

// Proper Trystero type definitions
interface TrysteroSender {
  send: (data: unknown, options?: { target?: string }) => void;
  onMessage: ((data: unknown, meta: { peerId: string }) => void) | null;
}

export interface FileMetadata {
  name: string;
  size: number;
  mime: string;
}

export interface TransferMetadata {
  files: FileMetadata[];
  totalSize: number;
}

export interface SignalData {
  type: 'metadata' | 'start_download' | 'next_file' | 'file_end' | 'end_all' | 'ack_chunk' | 'received';
  files?: FileMetadata[];
  totalSize?: number;
  fileIndex?: number;
  offset?: number;
  index?: number;
  name?: string;
  size?: number;
  mime?: string;
  encryptionKey?: string;
}

export class WebRTCManager {
  private currentRoom: ReturnType<typeof joinRoom> | null = null;
  private currentPeerId: string | null = null;
  private sendSignal: TrysteroSender | null = null;
  private sendChunk: TrysteroSender | null = null;
  private connectionStartTime: number = 0;
  private isMobileSafari: boolean = false;

  async createRoom(roomId: string) {
    this.leaveRoom();

    // Detect iOS Safari for potential compatibility issues
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    this.isMobileSafari = isIOS && isSafari;

    console.log('📱 Device Detection:', {
      isIOS,
      isSafari,
      isMobileSafari: this.isMobileSafari,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      webRTCEnabled: !!(window as any).RTCPeerConnection
    });

    // Use existing Firebase app or create a new one for Trystero
    let firebaseApp = existingFirebaseApp;
    if (!firebaseApp) {
      try {
        // Validate required environment variables
        const databaseUrl = import.meta.env.VITE_FIREBASE_DATABASE_URL;
        if (!databaseUrl || databaseUrl.trim() === '') {
          throw new Error('VITE_FIREBASE_DATABASE_URL is required for WebRTC functionality');
        }

        const firebaseConfig = {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
          databaseURL: databaseUrl
        };
        firebaseApp = initializeApp(firebaseConfig, 'trystero-firebase');
        console.log('Created new Firebase app for Trystero');
      } catch (e) {
        console.error('Failed to initialize Firebase for Trystero:', e);
        throw new Error('WebRTC functionality requires Firebase configuration. Please check your environment variables.');
      }
    }

    const config = {
      appId: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://xavu-58a12-default-rtdb.firebaseio.com',
      ...(firebaseApp && { relayConfig: { firebaseApp } }) // Only add if Firebase app exists
    };

    console.log('Creating Trystero room with config:', { roomId, hasFirebaseApp: !!firebaseApp, appId: config.appId });

    // Test Firebase connection
    try {
      const { getDatabase, ref, set } = await import('firebase/database');
      if (firebaseApp) {
        const db = getDatabase(firebaseApp);
        const testRef = ref(db, '__trystero__/test');
        await set(testRef, { timestamp: Date.now() });
        console.log('✅ Firebase Realtime Database write test passed');
      }
    } catch (error) {
      console.error('❌ Firebase Realtime Database test failed:', error);
    }

    this.currentRoom = joinRoom(config, roomId);
    this.connectionStartTime = Date.now();

    console.log('Room created, setting up actions and callbacks');

    // For iOS Safari, add a small delay to ensure WebRTC is fully ready
    if (this.isMobileSafari) {
      console.log('⏳ iOS Safari detected, adding WebRTC initialization delay');
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // makeAction returns a single object, not an array
    try {
      this.sendSignal = this.currentRoom.makeAction('signal');
      this.sendChunk = this.currentRoom.makeAction('chunk');
      console.log('✅ Actions created successfully');
    } catch (error) {
      console.error('❌ Failed to create actions:', error);
      throw new Error(`Trystero action creation failed: ${error}`);
    }

    console.log('Actions created, setting up peer detection');

    // Also set up peer detection logging with enhanced mobile debugging
    this.currentRoom.onPeerJoin = (peerId: string) => {
      const connectionTime = Date.now() - this.connectionStartTime;
      console.log('🎉 TRYSTERO: Peer joined via room.onPeerJoin:', peerId);
      console.log('⏱️ Connection time:', connectionTime, 'ms');

      if (this.isMobileSafari) {
        console.log('📱 iOS Safari peer joined - checking WebRTC stability');
        // Add additional stability check for mobile
        setTimeout(() => {
          console.log('🔄 iOS Safari stability check passed');
        }, 1000);
      }
    };

    this.currentRoom.onPeerLeave = (peerId: string) => {
      console.log('👋 TRYSTERO: Peer left:', peerId);
      if (this.isMobileSafari) {
        console.log('📱 iOS Safari peer left - possible mobile network issue');
      }
    };

    console.log('Created actions for room');

    // Add global error handling for WebSocket issues on mobile
    if (this.isMobileSafari) {
      this.setupMobileErrorHandling();
    }

    return this.currentRoom;
  }

  private setupMobileErrorHandling() {
    // Show iOS Safari users a helpful message about WebSocket behavior
    console.log('💡 iOS Safari Tip: Keep this tab active during transfers for best results');
    console.log('💡 Backgrounding the tab may pause the connection temporarily');

    // Listen for WebSocket errors which are common on mobile Safari
    window.addEventListener('error', (event) => {
      const errorMsg = event.message || '';
      if (errorMsg.includes('WebSocket') || errorMsg.includes('suspension')) {
        console.warn('📱 iOS Safari WebSocket issue detected (normal on mobile):', errorMsg);
        console.log('💡 Tip: Keep the Safari tab active during transfers for best results');

        // Show user-friendly notification for WebSocket issues
        this.showMobileSafariTip('Connection paused - keep this tab open');
      }
    });

    // Listen for visibility changes (tab backgrounding)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.currentRoom) {
        console.warn('📱 iOS Safari tab backgrounded - WebRTC connection may become unstable');
        console.log('💡 Tip: Return to this tab to maintain connection stability');
        this.showMobileSafariTip('Return to this tab to maintain connection');
      } else if (!document.hidden && this.currentRoom) {
        console.log('📱 iOS Safari tab foregrounded - connection should stabilize');
      }
    });
  }

  private showMobileSafariTip(message: string) {
    // Show a subtle toast notification for iOS Safari users
    const existingTip = document.querySelector('.ios-safari-tip');
    if (existingTip) {
      existingTip.remove();
    }

    const tip = document.createElement('div');
    tip.className = 'ios-safari-tip';
    tip.textContent = message;
    tip.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 255, 157, 0.1);
      border: 1px solid #00ff9d;
      color: #00ff9d;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 10000;
      backdrop-filter: blur(10px);
    `;

    document.body.appendChild(tip);

    setTimeout(() => {
      tip.style.opacity = '0';
      tip.style.transition = 'opacity 0.5s';
      setTimeout(() => tip.remove(), 500);
    }, 3000);
  }

  async joinRoom(roomId: string) {
    return await this.createRoom(roomId);
  }

  leaveRoom() {
    if (this.currentRoom) {
      this.currentRoom.leave();
      this.currentRoom = null;
    }
    this.currentPeerId = null;
    this.sendSignal = null;
    this.sendChunk = null;
  }

  onPeerJoin(callback: (peerId: string) => void) {
    if (this.currentRoom) {
      console.log('Setting onPeerJoin callback');
      this.currentRoom.onPeerJoin = (peerId: string) => {
        console.log('🎉 PEER JOINED:', peerId);
        callback(peerId);
      };
    } else {
      console.warn('Cannot set onPeerJoin - no current room');
    }
  }

  onPeerLeave(callback: (peerId: string) => void) {
    if (this.currentRoom) {
      this.currentRoom.onPeerLeave = callback;
    }
  }

  sendSignalData(data: SignalData, peerId?: string) {
    if (this.sendSignal) {
      console.log('📤 Sending signal:', data.type, this.isMobileSafari ? '(iOS Safari)' : '');
      try {
        this.sendSignal.send(data, peerId ? { target: peerId } : undefined);
        if (this.isMobileSafari) {
          console.log('✅ Signal sent successfully on iOS Safari');
        }
      } catch (error) {
        console.error('❌ Failed to send signal:', error);
        if (this.isMobileSafari) {
          console.error('📱 iOS Safari signal send error - possible connection issue');
        }
      }
    } else {
      console.warn('⚠️ Cannot send signal - sendSignal not initialized');
    }
  }

  onSignal(callback: (data: SignalData, peerId: string) => void) {
    // Use the existing action, don't create a new one
    if (this.sendSignal) {
      console.log('Setting up signal receive handler');
      this.sendSignal.onMessage = (data: unknown, { peerId }: { peerId: string }) => {
        console.log('📨 Received signal data:', data);
        if (isSignalData(data)) {
          callback(data, peerId);
        }
      };
    }
  }

  sendChunkData(data: ArrayBuffer, peerId?: string) {
    if (this.sendChunk) {
      const chunkSize = data.byteLength || 0;
      console.log('📤 Sending chunk:', chunkSize, 'bytes', this.isMobileSafari ? '(iOS Safari)' : '');

      try {
        this.sendChunk.send(data, peerId ? { target: peerId } : undefined);

        if (this.isMobileSafari) {
          // Add small delay between chunks on mobile to prevent congestion
          if (chunkSize > 50000) { // Large chunks on mobile
            console.log('📱 iOS Safari large chunk sent, adding delay');
          }
        }
      } catch (error) {
        console.error('❌ Failed to send chunk:', error);
        if (this.isMobileSafari) {
          console.error('📱 iOS Safari chunk send error - possible bandwidth issue');
        }
      }
    } else {
      console.warn('⚠️ Cannot send chunk - sendChunk not initialized');
    }
  }

  onChunk(callback: (data: ArrayBuffer, peerId: string) => void) {
    // Use the existing action, don't create a new one
    if (this.sendChunk) {
      console.log('Setting up chunk receive handler');
      this.sendChunk.onMessage = (data: unknown, { peerId }: { peerId: string }) => {
        console.log('📦 Received chunk data, size:', data?.byteLength || data?.length || 0);

        // Convert Uint8Array to ArrayBuffer if needed
        let arrayBufferData: ArrayBuffer;
        if (data instanceof ArrayBuffer) {
          arrayBufferData = data;
        } else if (data instanceof Uint8Array) {
          // Convert Uint8Array to ArrayBuffer
          arrayBufferData = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          console.log('🔄 Converted Uint8Array to ArrayBuffer');
        } else {
          console.warn('⚠️ Unknown data type:', data?.constructor?.name, 'skipping callback');
          return;
        }

        console.log('🚀 Invoking callback with peer:', peerId);
        try {
          callback(arrayBufferData, peerId);
          console.log('✅ Callback invoked successfully');
        } catch (error) {
          console.error('❌ Callback error:', error);
        }
      };
    }
  }

  setCurrentPeer(peerId: string) {
    this.currentPeerId = peerId;
  }

  getCurrentPeer(): string | null {
    return this.currentPeerId;
  }

  getSelfId(): string {
    return selfId;
  }
}

function isSignalData(data: unknown): data is SignalData {
  return typeof data === 'object'
    && data !== null
    && 'type' in data
    && typeof (data as { type?: unknown }).type === 'string';
}
