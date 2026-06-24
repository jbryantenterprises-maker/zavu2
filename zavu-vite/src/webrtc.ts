import { joinRoom, selfId } from '@trystero-p2p/firebase';
import { app as existingFirebaseApp } from './auth.js';
import { initializeApp } from 'firebase/app';

// Simplified Trystero types - using 'any' to avoid type conflicts
type TrysteroSender = any;
type TrysteroReceiver = any;

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
  private getSignal: TrysteroReceiver | null = null;
  private sendChunk: TrysteroSender | null = null;
  private getChunk: TrysteroReceiver | null = null;

  async createRoom(roomId: string) {
    this.leaveRoom();

    // Use existing Firebase app or create a new one for Trystero
    let firebaseApp = existingFirebaseApp;
    if (!firebaseApp) {
      try {
        const firebaseConfig = {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
          databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL
        };
        firebaseApp = initializeApp(firebaseConfig, 'trystero-firebase');
        console.log('Created new Firebase app for Trystero');
      } catch (e) {
        console.error('Failed to initialize Firebase for Trystero:', e);
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

    console.log('Room created, setting up actions and callbacks');
    // makeAction returns a single object, not an array
    this.sendSignal = this.currentRoom.makeAction('signal');
    this.sendChunk = this.currentRoom.makeAction('chunk');

    console.log('Actions created, setting up peer detection');

    // Also set up peer detection logging
    this.currentRoom.onPeerJoin = (peerId: string) => {
      console.log('🎉 TRYSTERO: Peer joined via room.onPeerJoin:', peerId);
    };

    this.currentRoom.onPeerLeave = (peerId: string) => {
      console.log('👋 TRYSTERO: Peer left:', peerId);
    };

    console.log('Created actions for room');
    return this.currentRoom;
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
    this.getSignal = null;
    this.sendChunk = null;
    this.getChunk = null;
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
      this.sendSignal.send(data, peerId ? { target: peerId } : undefined);
    }
  }

  onSignal(callback: (data: SignalData, peerId: string) => void) {
    // Create a new action for receiving signals
    this.getSignal = this.currentRoom?.makeAction('signal');
    if (this.getSignal) {
      this.getSignal.onMessage = (data: any, { peerId }: { peerId: string }) => {
        if (isSignalData(data)) {
          callback(data, peerId);
        }
      };
    }
  }

  sendChunkData(data: ArrayBuffer, peerId?: string) {
    if (this.sendChunk) {
      this.sendChunk.send(data, peerId ? { target: peerId } : undefined);
    }
  }

  onChunk(callback: (data: ArrayBuffer, peerId: string) => void) {
    // Create a new action for receiving chunks
    this.getChunk = this.currentRoom?.makeAction('chunk');
    if (this.getChunk) {
      this.getChunk.onMessage = (data: any, { peerId }: { peerId: string }) => {
        if (data instanceof ArrayBuffer) {
          callback(data, peerId);
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
