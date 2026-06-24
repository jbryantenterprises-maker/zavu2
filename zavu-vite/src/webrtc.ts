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

  createRoom(roomId: string) {
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

    console.log('Creating Trystero room with config:', { roomId, hasFirebaseApp: !!firebaseApp });
    this.currentRoom = joinRoom(config, roomId);

    // makeAction returns a single object, not an array
    this.sendSignal = this.currentRoom.makeAction('signal');
    this.sendChunk = this.currentRoom.makeAction('chunk');

    console.log('Created actions for room');
    return this.currentRoom;
  }

  joinRoom(roomId: string) {
    return this.createRoom(roomId);
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
      this.currentRoom.onPeerJoin = callback;
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
