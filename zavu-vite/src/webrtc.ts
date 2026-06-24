import { joinRoom, selfId } from 'trystero';

type TrysteroSender = ReturnType<ReturnType<typeof joinRoom>['makeAction']>[0];
type TrysteroReceiver = ReturnType<ReturnType<typeof joinRoom>['makeAction']>[1];

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
    const config = {
      appId: 'xavu-p2p-production-app',
      // Use alternative relay servers that are less restrictive
      relay: [
        'wss://relay.damus.io',
        'wss://purplepag.es',
        'wss://nos.lol'
      ]
    };
    this.currentRoom = joinRoom(config, roomId);
    
    [this.sendSignal, this.getSignal] = this.currentRoom.makeAction('signal');
    [this.sendChunk, this.getChunk] = this.currentRoom.makeAction('chunk');

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
      this.currentRoom.onPeerJoin(callback);
    }
  }

  onPeerLeave(callback: (peerId: string) => void) {
    if (this.currentRoom) {
      this.currentRoom.onPeerLeave(callback);
    }
  }

  sendSignalData(data: SignalData, peerId?: string) {
    if (this.sendSignal) {
      this.sendSignal(data as Parameters<TrysteroSender>[0], peerId);
    }
  }

  onSignal(callback: (data: SignalData, peerId: string) => void) {
    if (this.getSignal) {
      this.getSignal((data, peerId) => {
        if (isSignalData(data)) {
          callback(data, peerId);
        }
      });
    }
  }

  sendChunkData(data: ArrayBuffer, peerId?: string) {
    if (this.sendChunk) {
      this.sendChunk(data as Parameters<TrysteroSender>[0], peerId);
    }
  }

  onChunk(callback: (data: ArrayBuffer, peerId: string) => void) {
    if (this.getChunk) {
      this.getChunk((data, peerId) => {
        if (data instanceof ArrayBuffer) {
          callback(data, peerId);
        }
      });
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
