import { joinRoom, selfId } from 'trystero';

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
  encryptionIV?: string;
}

export class WebRTCManager {
  private currentRoom: any = null;
  private currentPeerId: string | null = null;
  private sendSignal: ((data: any, peerId?: string) => void) | null = null;
  private getSignal: ((callback: (data: any, peerId: string) => void) => void) | null = null;
  private sendChunk: ((data: ArrayBuffer, peerId?: string) => void) | null = null;
  private getChunk: ((callback: (data: ArrayBuffer, peerId: string) => void) => void) | null = null;

  createRoom(roomId: string) {
    const config = { appId: 'zavu-p2p-production-app' };
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
      this.sendSignal(data, peerId);
    }
  }

  onSignal(callback: (data: SignalData, peerId: string) => void) {
    if (this.getSignal) {
      this.getSignal(callback);
    }
  }

  sendChunkData(data: ArrayBuffer, peerId?: string) {
    if (this.sendChunk) {
      this.sendChunk(data, peerId);
    }
  }

  onChunk(callback: (data: ArrayBuffer, peerId: string) => void) {
    if (this.getChunk) {
      this.getChunk(callback);
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
